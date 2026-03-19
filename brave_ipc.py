"""
Brave IPC CDP Launcher
======================
Lanza Brave via IPC (subprocess pipe) con CDP dinámico.

Flujo:
  1. Proceso padre (este script) lanza Brave con --remote-debugging-port=0
  2. El OS asigna un puerto aleatorio
  3. Brave escribe el puerto real en DevToolsActivePort
  4. Este script lee el puerto y lo reporta
  5. CDP queda disponible sin puerto fijo ni firewall

Uso:
  python brave_ipc.py                   # Lanza Brave con CDP dinámico
  python brave_ipc.py --port 9222       # Fuerza puerto específico
  python brave_ipc.py --headless        # Modo headless (sin ventana)
  python brave_ipc.py --url https://..  # Abre URL al iniciar
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

# ─── Configuración ────────────────────────────────────────────────────────────

# Archivo de configuración persistente (se genera al primer uso)
CONFIG_FILE = Path(__file__).parent / "browser_config.json"
IPC_INFO_FILE = Path(__file__).parent / "cdp_info.json"

# Rutas de búsqueda por navegador (fallback si no hay config)
BROWSER_SEARCH_PATHS = {
    "brave": [
        r"C:\Program Files\BraveSoftware\Brave-Browser\Application\brave.exe",
        r"C:\Program Files (x86)\BraveSoftware\Brave-Browser\Application\brave.exe",
        os.path.expandvars(r"%LOCALAPPDATA%\BraveSoftware\Brave-Browser\Application\brave.exe"),
    ],
    "chrome": [
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
        os.path.expandvars(r"%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"),
    ],
    "edge": [
        r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
        r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
    ],
    "chromium": [
        os.path.expandvars(r"%LOCALAPPDATA%\Chromium\Application\chrome.exe"),
    ],
}

BROWSER_USER_DATA = {
    "brave": os.path.expandvars(r"%LOCALAPPDATA%\BraveSoftware\Brave-Browser\User Data"),
    "chrome": os.path.expandvars(r"%LOCALAPPDATA%\Google\Chrome\User Data"),
    "edge": os.path.expandvars(r"%LOCALAPPDATA%\Microsoft\Edge\User Data"),
    "chromium": os.path.expandvars(r"%LOCALAPPDATA%\Chromium\User Data"),
}

CLEAN_USER_DATA = Path(os.path.expandvars(r"%USERPROFILE%\browser-cdp-profile"))


# ─── Utilidades ───────────────────────────────────────────────────────────────

def load_config() -> dict:
    """Carga la configuración guardada del navegador."""
    if CONFIG_FILE.exists():
        try:
            return json.loads(CONFIG_FILE.read_text(encoding="utf-8"))
        except Exception:
            pass
    return {}


def save_config(data: dict):
    """Guarda la configuración del navegador."""
    CONFIG_FILE.write_text(json.dumps(data, indent=2), encoding="utf-8")


def detect_browsers() -> list[dict]:
    """Detecta todos los navegadores Chromium instalados en el sistema."""
    found = []
    for name, paths in BROWSER_SEARCH_PATHS.items():
        for p in paths:
            if Path(p).exists():
                found.append({"name": name, "exe": p, "user_data": BROWSER_USER_DATA.get(name, "")})
                break
    # Buscar también en PATH
    for cmd in ["brave", "chrome", "msedge", "chromium"]:
        exe = shutil.which(cmd) or shutil.which(f"{cmd}.exe")
        if exe and not any(b["exe"] == exe for b in found):
            found.append({"name": cmd, "exe": exe, "user_data": ""})
    return found


def find_browser(preferred: str = "") -> tuple[str, str, str]:
    """Busca el navegador a usar. Retorna (name, exe_path, user_data_dir).

    Prioridad:
      1. Configuración guardada en browser_config.json
      2. Flag --browser del CLI
      3. Detección automática (primer navegador encontrado)
    """
    # 1. Config guardada
    config = load_config()
    if config.get("exe") and Path(config["exe"]).exists():
        return config["name"], config["exe"], config.get("user_data", "")

    # 2. Preferred del CLI
    browsers = detect_browsers()
    if preferred:
        for b in browsers:
            if b["name"] == preferred.lower():
                save_config(b)
                return b["name"], b["exe"], b["user_data"]

    # 3. Primer navegador encontrado
    if browsers:
        save_config(browsers[0])
        return browsers[0]["name"], browsers[0]["exe"], browsers[0]["user_data"]

    return "", "", ""


def test_cdp(port: int, timeout: float = 3.0) -> dict | None:
    """Prueba si CDP responde en el puerto dado. Retorna version info o None."""
    try:
        url = f"http://127.0.0.1:{port}/json/version"
        req = urllib.request.Request(url)
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read())
    except Exception:
        return None


def read_devtools_active_port(user_data_dir: Path, timeout: int = 30) -> int | None:
    """Lee el archivo DevToolsActivePort que el navegador escribe al iniciar con CDP.

    Este archivo contiene:
      - Línea 1: puerto TCP
      - Línea 2: WebSocket path token
    """
    port_file = user_data_dir / "DevToolsActivePort"
    deadline = time.time() + timeout

    while time.time() < deadline:
        if port_file.exists():
            try:
                content = port_file.read_text().strip().splitlines()
                if content:
                    port = int(content[0].strip())
                    if port > 0:
                        return port
            except (ValueError, IndexError):
                pass
        time.sleep(0.5)

    return None


def get_pages(port: int) -> list[dict]:
    """Lista las páginas abiertas via CDP."""
    try:
        url = f"http://127.0.0.1:{port}/json/list"
        with urllib.request.urlopen(url, timeout=5) as resp:
            return json.loads(resp.read())
    except Exception:
        return []


def kill_browser(exe_path: str):
    """Mata todas las instancias del navegador."""
    exe_name = Path(exe_path).name  # brave.exe, chrome.exe, msedge.exe, etc.
    if sys.platform == "win32":
        subprocess.run(["taskkill", "/F", "/IM", exe_name],
                       capture_output=True, timeout=10)
    else:
        subprocess.run(["pkill", "-f", exe_name], capture_output=True, timeout=10)


def is_browser_running(exe_path: str) -> bool:
    """Verifica si el navegador ya está corriendo."""
    exe_name = Path(exe_path).name.lower()
    if sys.platform == "win32":
        try:
            result = subprocess.run(
                ["tasklist", "/FI", f"IMAGENAME eq {exe_name}", "/FO", "CSV", "/NH"],
                capture_output=True, text=True, timeout=10,
            )
            return exe_name in result.stdout.lower()
        except Exception:
            return False
    else:
        try:
            result = subprocess.run(["pgrep", "-f", exe_name], capture_output=True, timeout=5)
            return result.returncode == 0
        except Exception:
            return False


def detect_existing_cdp(exe_path: str, user_data_dir: Path) -> int | None:
    """Detecta si el navegador ya tiene CDP activo.

    Estrategia:
      1. Leer DevToolsActivePort del user-data-dir
      2. Escanear command line del proceso por --remote-debugging-port
      3. Escanear puertos del proceso buscando CDP
    """
    # 1. DevToolsActivePort
    port_file = user_data_dir / "DevToolsActivePort"
    if port_file.exists():
        try:
            content = port_file.read_text().strip().splitlines()
            if content:
                port = int(content[0].strip())
                if port > 0 and test_cdp(port):
                    return port
        except (ValueError, IndexError):
            pass

    # 2. Command line del proceso
    if sys.platform == "win32":
        import re
        exe_name = Path(exe_path).name.lower()
        try:
            result = subprocess.run(
                ["wmic", "process", "where", f"name='{exe_name}'", "get", "commandline", "/format:list"],
                capture_output=True, text=True, timeout=10,
            )
            for line in result.stdout.splitlines():
                m = re.search(r"--remote-debugging-port[=\s](\d{2,5})", line)
                if m:
                    port = int(m.group(1))
                    if port > 0 and test_cdp(port):
                        return port
        except Exception:
            pass

    # 3. Escanear puertos del proceso (netstat)
    if sys.platform == "win32":
        exe_name = Path(exe_path).name.lower()
        try:
            # Obtener PIDs del navegador
            tasklist = subprocess.run(
                ["tasklist", "/FI", f"IMAGENAME eq {exe_name}", "/FO", "CSV", "/NH"],
                capture_output=True, text=True, timeout=10,
            )
            pids = set()
            for line in tasklist.stdout.splitlines():
                parts = line.strip().strip('"').split('","')
                if len(parts) >= 2:
                    try:
                        pids.add(int(parts[1]))
                    except ValueError:
                        pass

            if pids:
                netstat = subprocess.run(
                    ["netstat", "-ano", "-p", "tcp"],
                    capture_output=True, text=True, timeout=10,
                )
                for line in netstat.stdout.splitlines():
                    tokens = line.split()
                    if len(tokens) >= 5 and "LISTENING" in tokens[3]:
                        try:
                            pid = int(tokens[4])
                            if pid in pids:
                                port_str = tokens[1].rsplit(":", 1)[1]
                                port = int(port_str)
                                if port > 1024 and test_cdp(port):
                                    return port
                        except (ValueError, IndexError):
                            pass
        except Exception:
            pass

    return None


def setup_firewall() -> bool:
    """Configura regla de firewall universal para todos los puertos CDP.

    Solo se ejecuta una vez — verifica si la regla ya existe.
    """
    if sys.platform != "win32":
        return False

    RULE_NAME = "CDP All Ports (IPC)"

    # Verificar si ya existe
    try:
        check = subprocess.run(
            ["netsh", "advfirewall", "firewall", "show", "rule", f"name={RULE_NAME}"],
            capture_output=True, text=True, timeout=10,
        )
        if RULE_NAME in check.stdout:
            return True  # Ya existe, silencioso
    except Exception:
        pass

    # Crear regla universal
    try:
        result = subprocess.run(
            ["netsh", "advfirewall", "firewall", "add", "rule",
             f"name={RULE_NAME}", "dir=in", "action=allow",
             "protocol=TCP", "localport=1024-65535"],
            capture_output=True, text=True, timeout=10,
        )
        if result.returncode == 0:
            print(f"        Firewall: regla universal creada")
            return True
    except Exception:
        pass

    return False


def setup_portproxy(port: int) -> bool:
    """Configura netsh portproxy + firewall para que WSL alcance el puerto CDP."""
    if sys.platform != "win32":
        return False

    # 1. Firewall universal (solo la primera vez)
    setup_firewall()

    # 2. Verificar si ya existe el portproxy para este puerto
    try:
        check = subprocess.run(
            ["netsh", "interface", "portproxy", "show", "all"],
            capture_output=True, text=True, timeout=10,
        )
        if f"0.0.0.0         {port}" in check.stdout:
            print(f"        Portproxy ya existe para puerto {port}")
            return True
    except Exception:
        pass

    # 3. Crear portproxy
    try:
        cmd = [
            "netsh", "interface", "portproxy", "add", "v4tov4",
            f"listenaddress=0.0.0.0", f"listenport={port}",
            f"connectaddress=127.0.0.1", f"connectport={port}",
        ]
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=10)
        if result.returncode == 0:
            print(f"        Portproxy configurado para puerto {port}")
            return True
        else:
            print(f"        [!] Portproxy fallo (sin permisos?). Ejecuta el .bat como Admin.")
            return False
    except Exception as e:
        print(f"        [!] No se pudo configurar portproxy: {e}")
        return False


def get_wsl_host_ip() -> str:
    """Detecta la IP que WSL usa para alcanzar Windows.

    Desde Windows: ejecuta wsl.exe para leer resolv.conf
    Desde WSL: lee resolv.conf directamente
    """
    import re

    # 1. Leer directamente (si estamos en WSL)
    resolv = Path("/etc/resolv.conf")
    if resolv.exists():
        try:
            content = resolv.read_text()
            match = re.search(r"nameserver\s+(\d+\.\d+\.\d+\.\d+)", content)
            if match:
                return match.group(1)
        except Exception:
            pass

    # 2. Desde Windows: leer via wsl.exe
    if sys.platform == "win32":
        try:
            result = subprocess.run(
                ["wsl.exe", "-e", "grep", "nameserver", "/etc/resolv.conf"],
                capture_output=True, text=True, timeout=10,
            )
            match = re.search(r"nameserver\s+(\d+\.\d+\.\d+\.\d+)", result.stdout)
            if match:
                return match.group(1)
        except Exception:
            pass

    # 3. Fallback: leer resolv.conf desde la ruta WSL en Windows
    if sys.platform == "win32":
        wsl_resolv = Path(r"\\wsl$\Ubuntu\etc\resolv.conf")
        if not wsl_resolv.exists():
            # Intentar con el nombre de la distro por defecto
            for distro in ["Ubuntu", "Ubuntu-22.04", "Ubuntu-24.04", "Debian"]:
                wsl_resolv = Path(rf"\\wsl$\{distro}\etc\resolv.conf")
                if wsl_resolv.exists():
                    break
        if wsl_resolv.exists():
            try:
                content = wsl_resolv.read_text()
                match = re.search(r"nameserver\s+(\d+\.\d+\.\d+\.\d+)", content)
                if match:
                    return match.group(1)
            except Exception:
                pass

    return "127.0.0.1"


def update_mcp_json(port: int) -> bool:
    """Actualiza el puerto del MCP 'brave' en todos los .mcp.json relevantes."""
    wsl_host_ip = get_wsl_host_ip()

    brave_entry = {
        "command": "npx",
        "args": ["-y", "chrome-devtools-mcp@latest", "--browserUrl", f"http://{wsl_host_ip}:{port}"]
    }

    # Actualizar ambos .mcp.json: el del home y el del proyecto IPC
    mcp_paths = [
        Path(os.path.expandvars(r"%USERPROFILE%\.mcp.json")),
        Path(__file__).parent / ".mcp.json",
    ]

    updated = 0
    for mcp_path in mcp_paths:
        try:
            if mcp_path.exists():
                data = json.loads(mcp_path.read_text(encoding="utf-8"))
            else:
                data = {"mcpServers": {}}

            if "mcpServers" not in data:
                data["mcpServers"] = {}

            data["mcpServers"]["brave"] = brave_entry
            mcp_path.write_text(json.dumps(data, indent=2), encoding="utf-8")
            updated += 1
        except Exception:
            pass

    print(f"        .mcp.json actualizado ({updated} archivos): brave → {wsl_host_ip}:{port}")
    return updated > 0


# ─── Launcher IPC principal ──────────────────────────────────────────────────

def launch_browser_ipc(
    port: int = 0,
    headless: bool = False,
    url: str = "",
    kill_existing: bool = True,
    clean: bool = False,
    browser: str = "",
) -> dict:
    """
    Lanza un navegador Chromium via IPC con CDP activado.

    Args:
        port: Puerto CDP. 0 = dinámico (OS asigna).
        headless: Modo sin ventana visible.
        url: URL para abrir al iniciar.
        kill_existing: Matar instancias previas.
        clean: True = perfil limpio separado, False = perfil real con todos tus datos.
        browser: Navegador preferido (brave, chrome, edge). Vacío = auto-detectar.

    Returns:
        Dict con DEBUG_PORT, DEBUG_WS, BROWSER, USER_DATA, CDP_URL

    Raises:
        RuntimeError si no puede iniciar o detectar CDP.
    """
    browser_name, browser_exe, user_data = find_browser(preferred=browser)

    if not browser_exe:
        installed = detect_browsers()
        if installed:
            names = ", ".join(b["name"] for b in installed)
            raise RuntimeError(f"Navegador '{browser}' no encontrado. Disponibles: {names}")
        raise RuntimeError("No se encontró ningún navegador Chromium instalado.")

    USER_DATA_DIR = CLEAN_USER_DATA if clean else Path(user_data) if user_data else CLEAN_USER_DATA

    # ─── DETECCION: ¿El navegador ya tiene CDP activo? ───────────────────
    print(f"[1/7] Verificando {browser_name}...")
    print(f"        Exe: {browser_exe}")

    if is_browser_running(browser_exe):
        print(f"        {browser_name} ya esta corriendo. Buscando CDP existente...")
        existing_port = detect_existing_cdp(browser_exe, USER_DATA_DIR)

        if existing_port:
            # CDP ya activo → no reiniciar, solo conectar
            print(f"        CDP detectado en puerto {existing_port}. Sin reiniciar!")
            actual_port = existing_port
            version_info = test_cdp(actual_port)
            browser_version = version_info.get("Browser", "Unknown") if version_info else "Unknown"
            ws_url = version_info.get("webSocketDebuggerUrl", "") if version_info else ""
            pages = get_pages(actual_port)

            print(f"[2/7] Configurando portproxy...")
            setup_portproxy(actual_port)
            print(f"[3/7] Actualizando .mcp.json...")
            update_mcp_json(actual_port)

            result = {
                "DEBUG_PORT": actual_port,
                "DEBUG_WS": ws_url,
                "BROWSER": browser_version,
                "BROWSER_EXE": browser_exe,
                "PID": 0,
                "USER_DATA": str(USER_DATA_DIR),
                "CDP_URL": f"http://127.0.0.1:{actual_port}",
                "PAGES": len(pages),
                "MODE": "ATTACHED",
            }
            IPC_INFO_FILE.write_text(json.dumps(result, indent=2), encoding="utf-8")

            print()
            print("=" * 55)
            print(f"  MODO:        ATTACHED (sin reiniciar)")
            print(f"  Navegador:   {browser_version} ({Path(browser_exe).name})")
            print(f"  Puerto CDP:  {actual_port}")
            print(f"  Paginas:     {len(pages)}")
            print(f"  Portproxy:   0.0.0.0:{actual_port} -> 127.0.0.1:{actual_port}")
            print(f"  .mcp.json:   Actualizado")
            print("=" * 55)
            print()
            print("  /mcp en Claude Code para reconectar.")
            print()
            return result
        else:
            # Navegador corriendo pero SIN CDP → hay que reiniciar
            print(f"        CDP no detectado. Reiniciando {browser_name} con CDP...")
            if kill_existing:
                kill_browser(browser_exe)
                time.sleep(2)
    elif kill_existing:
        print(f"        {browser_name} no esta corriendo.")

    # ─── LANZAMIENTO NUEVO ───────────────────────────────────────────────
    # Limpiar DevToolsActivePort anterior
    port_file = USER_DATA_DIR / "DevToolsActivePort"
    if port_file.exists():
        port_file.unlink()

    profile_label = "LIMPIO" if clean else "REAL (tus datos)"
    print(f"[2/7] Lanzando {browser_name} con CDP...")
    print(f"        Perfil: {profile_label}")

    args = [
        browser_exe,
        f"--remote-debugging-port={port}",
        "--remote-allow-origins=*",
    ]

    # Solo agregar --user-data-dir si es perfil limpio
    if clean:
        args.append(f"--user-data-dir={USER_DATA_DIR}")

    args.extend([
        "--disable-backgrounding-occluded-windows",
    ])

    if headless:
        args.append("--headless=new")

    if url:
        args.append(url)

    # ─── LANZAMIENTO IPC ─────────────────────────────────────────────────
    # El proceso padre (este script) lanza Brave como subprocess.
    # La comunicación IPC se da a través del filesystem (DevToolsActivePort)
    # y luego via CDP HTTP/WebSocket.
    print(f"        Puerto: {'dinamico' if port == 0 else port}")

    process = subprocess.Popen(
        args,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        creationflags=subprocess.DETACHED_PROCESS if sys.platform == "win32" else 0,
    )

    print(f"[3/7] {browser_name} iniciado (PID: {process.pid}). Esperando CDP...")

    # ─── DETECCIÓN DE PUERTO ─────────────────────────────────────────────
    if port == 0:
        # Puerto dinámico: leer DevToolsActivePort
        detected = read_devtools_active_port(USER_DATA_DIR, timeout=30)
        if not detected:
            raise RuntimeError(
                "No se detectó DevToolsActivePort. "
                "Brave puede haber fallado al iniciar."
            )
        actual_port = detected
        print(f"[4/7] Puerto dinamico detectado via IPC: {actual_port}")
    else:
        actual_port = port
        # Esperar a que el puerto fijo responda
        deadline = time.time() + 30
        while time.time() < deadline:
            if test_cdp(actual_port):
                break
            time.sleep(0.5)
        print(f"[4/7] Puerto fijo confirmado: {actual_port}")

    # Verificar CDP
    version_info = test_cdp(actual_port)
    if not version_info:
        raise RuntimeError(f"CDP no responde en puerto {actual_port}.")

    browser_name = version_info.get("Browser", "Unknown")
    ws_url = version_info.get("webSocketDebuggerUrl", "")
    pages = get_pages(actual_port)

    # ─── PORTPROXY + MCP AUTOMATICO ─────────────────────────────────────
    print(f"[5/7] Configurando portproxy para WSL...")
    setup_portproxy(actual_port)

    print(f"[6/7] Actualizando .mcp.json...")
    update_mcp_json(actual_port)

    # Guardar info para otros procesos
    result = {
        "DEBUG_PORT": actual_port,
        "DEBUG_WS": ws_url,
        "BROWSER": browser_name,
        "BROWSER_EXE": browser_exe,
        "PID": process.pid,
        "USER_DATA": str(USER_DATA_DIR),
        "CDP_URL": f"http://127.0.0.1:{actual_port}",
        "PAGES": len(pages),
    }

    IPC_INFO_FILE.write_text(json.dumps(result, indent=2), encoding="utf-8")

    print(f"[7/7] Todo listo!")
    print()
    print("=" * 55)
    print(f"  MODO:        LAUNCHED (nuevo proceso)")
    print(f"  Navegador:   {browser_name} ({Path(browser_exe).name})")
    print(f"  Puerto CDP:  {actual_port} (dinamico via IPC)")
    print(f"  CDP URL:     http://127.0.0.1:{actual_port}")
    print(f"  WebSocket:   {ws_url}")
    print(f"  Paginas:     {len(pages)}")
    print(f"  PID:         {process.pid}")
    print(f"  Perfil:      {'LIMPIO' if clean else 'REAL (tus datos)'}")
    print(f"  Portproxy:   0.0.0.0:{actual_port} -> 127.0.0.1:{actual_port}")
    print(f"  .mcp.json:   Actualizado")
    print("=" * 55)
    print()
    print("  /mcp en Claude Code para reconectar.")
    print()

    return result


# ─── CLI ──────────────────────────────────────────────────────────────────────

def main() -> int:
    import argparse
    parser = argparse.ArgumentParser(
        description="Browser IPC CDP Launcher - Abre cualquier navegador Chromium con CDP via IPC",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Ejemplos:
  python brave_ipc.py                        # Auto-detecta navegador + CDP
  python brave_ipc.py --browser brave        # Forzar Brave
  python brave_ipc.py --browser chrome       # Forzar Chrome
  python brave_ipc.py --browser edge         # Forzar Edge
  python brave_ipc.py --clean                # Perfil limpio separado
  python brave_ipc.py --port 9222            # Puerto fijo
  python brave_ipc.py --url https://n8n.io   # Abre URL
  python brave_ipc.py --headless             # Sin ventana
  python brave_ipc.py --no-kill              # No mata el navegador existente
  python brave_ipc.py --list                 # Lista navegadores instalados
        """,
    )
    parser.add_argument("--browser", default="",
                        help="Navegador a usar (brave, chrome, edge, chromium). Vacío = auto-detectar")
    parser.add_argument("--port", type=int, default=0,
                        help="Puerto CDP (0=dinámico, OS asigna)")
    parser.add_argument("--headless", action="store_true",
                        help="Modo headless (sin ventana visible)")
    parser.add_argument("--url", default="",
                        help="URL para abrir al iniciar")
    parser.add_argument("--no-kill", action="store_true",
                        help="No matar instancias previas")
    parser.add_argument("--clean", action="store_true",
                        help="Usar perfil limpio separado (sin tus datos)")
    parser.add_argument("--list", action="store_true",
                        help="Listar navegadores Chromium instalados")
    args = parser.parse_args()

    if args.list:
        browsers = detect_browsers()
        if not browsers:
            print("No se encontraron navegadores Chromium instalados.")
            return 1
        print("Navegadores Chromium detectados:")
        for b in browsers:
            print(f"  - {b['name']:10s} → {b['exe']}")
        config = load_config()
        if config.get("name"):
            print(f"\nConfigurado: {config['name']} ({config.get('exe', '')})")
        return 0

    try:
        result = launch_browser_ipc(
            port=args.port,
            headless=args.headless,
            url=args.url,
            kill_existing=not args.no_kill,
            clean=args.clean,
            browser=args.browser,
        )
        return 0
    except RuntimeError as e:
        print(f"\n[ERROR] {e}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
