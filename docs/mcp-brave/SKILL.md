---
name: mcp-brave
description: Conectar y controlar Brave Browser via IPC + CDP. Usar cuando el usuario pida "abrir brave", "conectar brave", "usar brave", "navegar con brave", "controlar brave", "brave cdp", "brave ipc", o quiera interactuar con su navegador real desde Claude Code.
version: 3.0.1
---

# MCP Brave — Control de Brave via IPC + CDP

Conecta Claude Code al **Brave real del usuario** (con sus bookmarks, sesiones y
extensiones) por el Chrome DevTools Protocol.

**Desde v3 hay un proxy CDP en puerto FIJO `9333`**: chrome-devtools-mcp apunta
siempre a `http://127.0.0.1:9333` y el proxy re-resuelve el puerto real del
navegador en CADA conexión. Consecuencia práctica: **el puerto ya NO cambia para
el cliente**, aunque Brave se reinicie o arranque después. No hay que reescribir
nada ni adivinar puertos.

**Modo de operación: AUTÓNOMO.** Ejecuta paso a paso sin preguntar.

---

## Arquitectura (v3.0.0+)

```
chrome-devtools-mcp ──> http://127.0.0.1:9333  (proxy, puerto FIJO)
                              |
                              v  re-resuelve el puerto real EN CADA conexión
                        Brave/Chrome en :54xxx (cambia en cada reinicio)
```

- El launcher (`brave_mcp_launcher.js`) solo cablea; la lógica vive en `src/`
  (MVC): `platform/` (win/darwin/linux/wsl), `services/` (cdp-service, cdp-proxy,
  auto-launch, cursor-overlay), `controllers/`, `views/`.
- Cascada de resolución del puerto (rápida → lenta): DevToolsActivePort de los
  perfiles → discovery por procesos (ps+lsof en mac/linux, tasklist+netstat en
  Windows) → auto-launch via `brave_ipc.py` (último recurso, cooldown 30s).
- `cdp_info.json` se sigue escribiendo, pero `CDP_URL` apunta al **proxy** y
  `BACKEND_URL` al puerto real.

---

## PASO 0 — Detecta el entorno (decide ANTES de tocar nada)

El comando y la URL cambian según dónde corre Claude Code (distingue los cuatro
casos — Linux nativo también tiene `/proc/version`):

```bash
if grep -qi microsoft /proc/version 2>/dev/null; then echo WSL
elif [ "$(uname -s 2>/dev/null)" = "Darwin" ]; then echo MAC
elif [ "$(uname -s 2>/dev/null)" = "Linux" ]; then echo LINUX
else echo WINDOWS; fi
```

| Entorno | URL del cliente MCP | Cómo lanzar Brave |
|---------|--------------------|-------------------|
| **WSL** — Claude Code en WSL, Brave en el host Windows | `http://127.0.0.1:9333` (el proxy corre local) | `cmd.exe /c ...\brave_cdp.bat` |
| **Windows nativo** | `http://127.0.0.1:9333` | `...\brave_cdp.bat` o `python brave_ipc.py` |
| **macOS nativo** | `http://127.0.0.1:9333` | `python3 brave_ipc.py` |
| **Linux nativo** | `http://127.0.0.1:9333` | `python3 brave_ipc.py` |

> Con el proxy, **los cuatro entornos usan `127.0.0.1:9333`** desde el lado del
> cliente. `brave_ipc.py` ya conoce las rutas de Brave en los tres SO.

---

## PASO 1 — ¿Ya hay un Brave con CDP activo?

En la mayoría de casos **no necesitas hacer nada manual**: el launcher resuelve o
auto-lanza Brave solo. Para verificar el estado:

```bash
# Diagnóstico rápido: imprime el puerto real resuelto (o null) y sale
node <ruta>/brave_mcp_launcher.js --resolve-only

# ¿El proxy está vivo? (responde con header x-cdp-proxy: browser-ipc-cdp)
curl -s -i --connect-timeout 3 http://127.0.0.1:9333/json/version | head
```

| Resultado | Acción |
|-----------|--------|
| `--resolve-only` imprime un puerto y el proxy responde 200 | Listo → **PASO 3** |
| `--resolve-only` imprime `null` / proxy da 502 | Brave no está → **PASO 2** |

---

## PASO 2 — Lanzar Brave con CDP

Normalmente el launcher lo hace solo (auto-launch on-demand vía el proxy). Si
hace falta forzarlo:

```bash
python3 brave_ipc.py            # macOS / Linux — perfil REAL
python  brave_ipc.py            # Windows
python3 brave_ipc.py --clean    # perfil limpio (sesión vacía, para pruebas)
```

| Comando | Perfil |
|---------|--------|
| `brave_ipc.py` | **REAL** — Brave con bookmarks, sesiones, extensiones |
| `brave_ipc.py --clean` | **Limpio** — sesión vacía |

Tras lanzar, pide al usuario que haga **`/mcp`** en Claude Code para (re)conectar
el servidor `brave`. Con el proxy, un cambio de puerto de Brave NO requiere
reconectar; solo se reconecta si el propio MCP se cayó.

---

## PASO 3 — Usar el MCP Brave

Antes de interactuar, **siempre** toma un snapshot para tener los `uid` frescos.

### Navegación
- `mcp__brave__list_pages` — listar tabs
- `mcp__brave__select_page` — seleccionar tab por id
- `mcp__brave__navigate_page` — ir a URL / back / forward / reload
- `mcp__brave__new_page` / `mcp__brave__close_page` — abrir / cerrar tab

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

## Cursor overlay (v3.0.1+) — ENCENDIDO por defecto

El MCP inyecta un **overlay visual** en cada página: una flecha azul que sigue el
mouse, una onda en cada click y una etiqueta con el elemento tocado. Sirve para
que se vea **qué y dónde** hace click el agente. Se auto-inyecta en cada página
nueva (sobrevive navegación/recarga) y se reconecta si Brave cambia de puerto.

- **ON por defecto** desde v3.0.1: basta tener la versión instalada, sin flag por
  config. (En v3.0.0 era opt-in con `BROWSER_CDP_CURSOR=1`.)
- Para **apagarlo**: `BROWSER_CDP_CURSOR=0` en el `env` del server `brave`.

---

## Variables de entorno

| Var | Efecto |
|-----|--------|
| `BROWSER_CDP_PROXY_PORT` | Puerto fijo del proxy (default `9333`; si está ocupado prueba los siguientes) |
| `BROWSER_CDP_CURSOR=0` | Apaga el overlay del cursor (ON por defecto) |
| `BROWSER_CDP_NO_PROXY=1` | Desactiva el proxy (comportamiento legacy, puerto directo) |
| `BROWSER_CDP_EXTRA_PROFILES` | User Data dirs extra a inspeccionar, separados por `;` `:` `,` |

Flags de diagnóstico del launcher: `--resolve-only` (imprime el puerto resuelto y
sale) · `--proxy-only` (levanta solo el proxy, sin chrome-devtools-mcp).

---

## Datos técnicos

| Campo | Valor |
|-------|-------|
| Puerto del cliente | **`9333` fijo** (el proxy) — nunca cambia |
| Puerto real de Brave | En `cdp_info.json` → `BACKEND_URL` (informativo; el cliente no lo usa) |
| Estado / WS | `cdp_info.json` → `MODE` (`PROXY`/`RESOLVED`), `DEBUG_WS` |
| MCP server | `brave` → `node brave_mcp_launcher.js` |
| Perfil real (mac) | `~/Library/Application Support/BraveSoftware/Brave-Browser` |
| Perfil real (win) | `%LOCALAPPDATA%\BraveSoftware\Brave-Browser\User Data` |
| Perfil real (linux) | `~/.config/BraveSoftware/Brave-Browser` |
| Perfil limpio | `~/browser-cdp-profile` |

---

## Troubleshooting

| Problema | Solución |
|----------|----------|
| MCP `brave` no conecta / `/mcp` da timeout | Verifica el proxy: `curl -i http://127.0.0.1:9333/json/version` (debe traer header `x-cdp-proxy`). Si Brave corre SIN `--remote-debugging-port`, relánzalo con el PASO 2 |
| `--resolve-only` imprime `null` | No hay Brave con CDP vivo → PASO 2 (o deja que el auto-launch lo levante on-demand) |
| El puerto de Brave cambió | **No hay que hacer nada**: el proxy re-resuelve solo en la siguiente llamada |
| El cursor overlay no aparece | Confirma que el `env` del server `brave` NO tenga `BROWSER_CDP_CURSOR=0`; ON es el default desde v3.0.1 |
| `:9333` ocupado por sesión previa | El launcher detecta el proxy huérfano (header `x-cdp-proxy`), lo reemplaza y toma el puerto; el fijo se mantiene fijo |
| (WSL) CDP no responde | Revisa portproxy: `cmd.exe /c netsh interface portproxy show all` |
| MCP "wedged" (`The selected page has been closed`) | Toggle del server en `/mcp` (off → on); es del handle de chrome-devtools-mcp, no del puerto |
