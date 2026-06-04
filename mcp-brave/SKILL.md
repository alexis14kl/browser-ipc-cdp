---
name: mcp-brave
description: Conectar y controlar Brave Browser via IPC + CDP. Usar cuando el usuario pida "abrir brave", "conectar brave", "usar brave", "navegar con brave", "controlar brave", "brave cdp", "brave ipc", o quiera interactuar con su navegador real desde Claude Code.
version: 2.0.0
---

# MCP Brave — Control de Brave via IPC + CDP

Conecta Claude Code al **Brave real del usuario** (con sus bookmarks, sesiones y
extensiones) por el Chrome DevTools Protocol. El MCP `brave` lee `cdp_info.json`
en cada llamada, así que el puerto siempre sale de ahí — nunca lo adivines.

**Modo de operación: AUTÓNOMO.** Ejecuta paso a paso sin preguntar.

---

## PASO 0 — Detecta el entorno (decide ANTES de tocar nada)

El comando y la URL del CDP cambian según dónde corre Claude Code. Detecta primero
(distingue los cuatro casos sin ambigüedad — Linux nativo también tiene `/proc/version`):

```bash
if grep -qi microsoft /proc/version 2>/dev/null; then echo WSL
elif [ "$(uname -s 2>/dev/null)" = "Darwin" ]; then echo MAC
elif [ "$(uname -s 2>/dev/null)" = "Linux" ]; then echo LINUX
else echo WINDOWS; fi
```

(En cmd/PowerShell puro `uname` no existe → cae a `WINDOWS`, correcto.)

| Resultado | Entorno | URL del CDP | Cómo lanzar Brave |
|-----------|---------|-------------|-------------------|
| `WSL` | **WSL** — Claude Code en WSL, Brave en el host Windows | `http://<WSL_IP>:<PUERTO>` (campo `WSL_IP` de `cdp_info.json`) | `cmd.exe /c C:\Users\NyGsoft\Desktop\ipc\brave_cdp.bat` |
| `WINDOWS` | **Windows nativo** | `http://127.0.0.1:<PUERTO>` | `C:\Users\NyGsoft\Desktop\ipc\brave_cdp.bat` |
| `MAC` | **macOS nativo** | `http://127.0.0.1:<PUERTO>` | `python3 brave_ipc.py` |
| `LINUX` | **Linux nativo** | `http://127.0.0.1:<PUERTO>` | `python3 brave_ipc.py` |

> Solo **WSL** usa `WSL_IP` + portproxy (Brave vive en Windows). Windows, macOS y Linux
> nativos usan `127.0.0.1` directo, sin portproxy. `brave_ipc.py` ya conoce las rutas
> de Brave en los tres SO (Program Files / Brave Browser.app / /usr/bin/brave-browser).

---

## PASO 1 — ¿Ya hay un Brave con CDP activo?

Lee el puerto de `cdp_info.json` y prueba el endpoint:

```bash
# El archivo vive en la carpeta del proyecto:
cat C:\Users\NyGsoft\Desktop\ipc\cdp_info.json    # Windows
# cat /mnt/c/Users/NyGsoft/Desktop/ipc/cdp_info.json   # WSL

# Verifica (usa la URL de la tabla del PASO 0 con el DEBUG_PORT del json):
curl -s --connect-timeout 3 http://127.0.0.1:<PUERTO>/json/version
```

| Resultado | Acción |
|-----------|--------|
| Responde JSON con `webSocketDebuggerUrl` | Ya está listo → **PASO 3** |
| No responde / `cdp_info.json` no existe | → **PASO 2** |

---

## PASO 2 — Lanzar Brave con CDP (método único canónico)

Ejecuta el launcher. Cierra el Brave previo, abre Brave con puerto de depuración,
detecta el puerto real, y **reescribe `cdp_info.json` y `.mcp.json`** solo:

```bat
:: Windows (pide UAC una vez para el portproxy; acepta)
C:\Users\NyGsoft\Desktop\ipc\brave_cdp.bat

:: o directo, sin el wrapper .bat:
python C:\Users\NyGsoft\Desktop\ipc\brave_ipc.py
```

Perfiles:

| Comando | Perfil |
|---------|--------|
| `python brave_ipc.py` | **REAL** — tu Brave con bookmarks, sesiones, extensiones |
| `python brave_ipc.py --clean` | **Limpio** — sesión vacía para pruebas |

Tras lanzar, pide al usuario que haga **`/mcp`** en Claude Code para reconectar el
servidor `brave` (lee el `cdp_info.json` ya actualizado).

---

## PASO 3 — Usar el MCP Brave

Antes de interactuar, **siempre** toma un snapshot para tener los `uid` frescos.

### Navegación
- `mcp__brave__list_pages` — listar tabs
- `mcp__brave__select_page` — seleccionar tab por id
- `mcp__brave__navigate_page` — ir a URL / back / forward / reload
- `mcp__brave__new_page` — abrir tab
- `mcp__brave__close_page` — cerrar tab

### Interacción (requiere `uid` de un snapshot reciente)
- `mcp__brave__take_snapshot` — leer la página (árbol a11y con uids) ← úsalo primero
- `mcp__brave__take_screenshot` — captura visual
- `mcp__brave__click` — click por uid
- `mcp__brave__fill` / `mcp__brave__fill_form` — escribir en campo(s)
- `mcp__brave__type_text` — teclear carácter a carácter
- `mcp__brave__press_key` — Enter, Tab, etc.
- `mcp__brave__hover` — hover por uid

### Avanzado
- `mcp__brave__evaluate_script` — ejecutar JS en la página
- `mcp__brave__list_network_requests` / `get_network_request` — tráfico de red
- `mcp__brave__list_console_messages` — consola
- `mcp__brave__lighthouse_audit` — performance / SEO

---

## Datos técnicos

| Campo | Valor |
|-------|-------|
| Brave exe | `C:\Program Files\BraveSoftware\Brave-Browser\Application\brave.exe` |
| Perfil real | `%LOCALAPPDATA%\BraveSoftware\Brave-Browser\User Data` |
| Perfil limpio | `%USERPROFILE%\brave-cdp-profile` |
| Puerto CDP | En `cdp_info.json` (`DEBUG_PORT`) — léelo, no lo asumas |
| Estado / WS | `cdp_info.json` → `MODE`, `DEBUG_WS` |
| MCP server | `brave` → `node brave_mcp_launcher.js` (lee `cdp_info.json` en cada uso) |
| Scripts | `C:\Users\NyGsoft\Desktop\ipc\` |

---

## Troubleshooting

| Problema | Solución |
|----------|----------|
| MCP `brave` no conecta | Confirma que `cdp_info.json` tiene el puerto donde Brave escucha; luego `/mcp` |
| `curl /json/version` falla con Brave abierto | Brave reusó un proceso sin `--remote-debugging-port`. Relanza con el PASO 2 |
| (WSL) CDP no responde | `cmd.exe /c netsh interface portproxy show all`; revisa `WSL_IP` en `cdp_info.json` |
| (WSL) IP cambió | `grep nameserver /etc/resolv.conf` → vuelve a correr el PASO 2 (reescribe todo) |
| Puerto en uso | `netstat -ano | findstr :<PUERTO>` y cierra el PID, o relanza (el launcher elige otro) |
| UAC pide permiso | Normal: el portproxy necesita Admin. Acepta una vez por sesión |
