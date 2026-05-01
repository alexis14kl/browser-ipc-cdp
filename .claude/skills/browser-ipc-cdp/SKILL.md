---
name: browser-ipc-cdp
description: Conecta Claude Code a tu navegador Chromium real (Brave/Chrome/Edge) via IPC + CDP con puerto dinamico. Activar cuando usuario pida "conectar mi navegador real", "controlar brave/chrome con claude", "browser ipc cdp", "mcp brave dinamico", "abrir navegador con sesiones reales para mcp", "conectar wsl a brave windows", o invoque /browser-ipc-cdp. Lanza navegador con --remote-debugging-port=0 (puerto OS-asignado), lee DevToolsActivePort, configura portproxy/firewall WSL, actualiza .mcp.json, deja MCP brave listo.
---

# browser-ipc-cdp

Lanza navegador Chromium real (con bookmarks/passwords/extensiones/sesiones del usuario) con CDP en puerto dinamico via IPC. Configura todo para que MCP `brave` (chrome-devtools-mcp) attache automaticamente. Cross-platform: Windows / WSL / macOS / Linux.

## Trigger

Usuario pide:
- "conecta mi brave real a claude"
- "abre chrome con cdp dinamico"
- "controla mi navegador con sesiones activas"
- "configurar mcp brave"
- "browser-ipc-cdp"
- "ipc cdp navegador"
- WSL no llega a Brave de Windows
- Necesita controlar tabs ya logueadas (Jira/n8n/WhatsApp/etc) sin re-login

## Diferencia vs `abrir-brave-cdp`

| Skill | Puerto | Profile | Datos |
|-------|--------|---------|-------|
| `abrir-brave-cdp` | Fijo `9222` | Separado | Sesion vacia |
| `browser-ipc-cdp` | **Dinamico** (OS asigna) | **Real** del usuario | **Todo**: bookmarks, passwords, extensiones, sesiones |

Usar `browser-ipc-cdp` cuando el usuario quiera control sobre su navegador **real** ya logueado. Usar `abrir-brave-cdp` para testing aislado.

## Comando principal

```bash
npx browser-ipc-cdp
```

Esto hace todo:
1. Detecta navegador (Brave > Chrome > Edge)
2. Mata instancia previa si choca con CDP
3. Lanza con `--remote-debugging-port=0` + profile real
4. Lee `DevToolsActivePort` (IPC filesystem) para obtener puerto asignado por OS
5. Verifica `http://127.0.0.1:<port>/json/version`
6. Guarda `cdp_info.json` con puerto + WS + PID
7. **WSL**: configura portproxy + firewall via PowerShell elevado
8. Actualiza `.mcp.json` con `browserUrl` correcto (IP host WSL si aplica)
9. Mensaje final: ejecutar `/mcp` en Claude Code para reconectar

## Flags

```bash
npx browser-ipc-cdp                      # Auto: navegador real + puerto dinamico
npx browser-ipc-cdp --browser brave      # Forzar Brave
npx browser-ipc-cdp --browser chrome     # Forzar Chrome
npx browser-ipc-cdp --browser edge       # Forzar Edge
npx browser-ipc-cdp --port 9222          # Puerto fijo
npx browser-ipc-cdp --clean              # Profile limpio (no datos reales)
npx browser-ipc-cdp --list               # Lista navegadores detectados
npx browser-ipc-cdp --status             # Estado sesion CDP actual
npx browser-ipc-cdp --uninstall          # Limpiar config
```

## Instalacion (solo si npx no es opcion)

```bash
npm install -g browser-ipc-cdp
browser-ipc-cdp
```

Repo local (dev):
```bash
cd C:\Users\NyGsoft\Desktop\ipc
npm install -g .
```

## Como funciona (IPC + CDP dinamico)

```
1. Lanzar Chromium con --remote-debugging-port=0
2. OS asigna puerto libre (ej: 58553)
3. Chromium escribe puerto en archivo DevToolsActivePort dentro de user-data-dir
4. browser-ipc-cdp lee archivo (esto = IPC via filesystem)
5. Conexion HTTP/WS al puerto leido
```

Mismo patron que usa Playwright/Puppeteer internamente. Sin puertos fijos = sin conflictos, sin firewall manual por puerto.

## cdp_info.json (output)

Tras ejecucion exitosa, escribe en cwd o home:

```json
{
  "DEBUG_PORT": 59152,
  "DEBUG_WS": "ws://127.0.0.1:59152/devtools/browser/<UUID>",
  "BROWSER": "Chrome/146.0.7680.80",
  "PID": 25552,
  "USER_DATA": "C:\\Users\\<user>\\AppData\\Local\\BraveSoftware\\Brave-Browser\\User Data",
  "CDP_URL": "http://127.0.0.1:59152",
  "PAGES": 23,
  "MODE": "LAUNCHED"
}
```

Otros scripts pueden leer este archivo para obtener puerto vigente.

## .mcp.json (auto-actualizado)

```json
{
  "mcpServers": {
    "brave": {
      "command": "npx",
      "args": ["-y", "chrome-devtools-mcp@latest", "--browserUrl", "http://<HOST>:<PUERTO>"]
    }
  }
}
```

- Windows nativo: `<HOST>` = `127.0.0.1`
- WSL: `<HOST>` = IP del host Windows (lee `/etc/resolv.conf` nameserver)
- `<PUERTO>` = puerto dinamico de `cdp_info.json`

## WSL: portproxy + firewall

WSL no alcanza `127.0.0.1` de Windows. browser-ipc-cdp ejecuta automaticamente (con auto-elevacion):

```powershell
netsh interface portproxy add v4tov4 listenaddress=0.0.0.0 listenport=<PUERTO> connectaddress=127.0.0.1 connectport=<PUERTO>
netsh advfirewall firewall add rule name="CDP Dynamic Range" dir=in action=allow protocol=TCP localport=50000-65000
```

Regla firewall del rango 50000-65000 = configuracion **una sola vez**, cubre cualquier puerto dinamico futuro.

## Tools MCP disponibles tras conexion

```
mcp__brave__list_pages              → Lista tabs abiertas
mcp__brave__navigate_page           → Navegar URL
mcp__brave__take_snapshot           → Leer DOM/contenido
mcp__brave__take_screenshot         → Captura PNG
mcp__brave__click                   → Click elemento
mcp__brave__fill / fill_form        → Escribir inputs
mcp__brave__press_key               → Tecla
mcp__brave__evaluate_script         → JS arbitrario
mcp__brave__list_network_requests   → Network log
mcp__brave__list_console_messages   → Console log
mcp__brave__hover / drag / upload_file
mcp__brave__lighthouse_audit
mcp__brave__performance_start_trace / stop_trace
```

## Flujo completo (caso WSL)

```
1. Cerrar Brave (si esta abierto con profile real)
2. npx browser-ipc-cdp
3. Output: "Puerto CDP: 59152", ".mcp.json actualizado", "portproxy configurado"
4. En Claude Code: /mcp  →  reconnected to brave
5. Listo: mcp__brave__list_pages funciona
```

## Troubleshooting

| Sintoma | Causa | Fix |
|---------|-------|-----|
| `No se encontraron navegadores` | Sin Brave/Chrome/Edge | Instalar uno o `--browser <ruta>` |
| `DevToolsActivePort` no aparece | Brave aun no escribio | Esperar 5-10s, reintentar |
| Puerto detectado pero `/json/version` 404 | Profile reusado sin CDP | Cerrar TODAS instancias del navegador y relanzar |
| WSL no conecta tras success | Portproxy fallo (no admin) | Re-ejecutar — pide elevacion UAC |
| `/mcp` muestra "failed" | `.mcp.json` con IP/puerto stale | Verificar `cdp_info.json` vs `.mcp.json` |
| IP WSL cambio (post-reboot) | nameserver `/etc/resolv.conf` distinto | Re-ejecutar `npx browser-ipc-cdp` |
| Brave abierto pero sin CDP | Proceso reuso por user-data-dir | Cerrar Brave completo y relanzar |

## Reglas para Claude

- Si usuario pide "conectar mi navegador real" → usar `browser-ipc-cdp` (no `abrir-brave-cdp`).
- Tras ejecutar, recordar al usuario correr `/mcp` en Claude Code.
- Si usuario dice "no funciona" tras reboot → IP WSL cambio, re-ejecutar.
- Nunca matar Brave del usuario sin avisar (puede tener trabajo no guardado). Usar `--no-kill` si dudas.
- Para testing aislado/CI → sugerir `--clean` (profile efimero).
- Verificar `cdp_info.json` antes de asumir conexion activa: `npx browser-ipc-cdp --status`.

## Repo

- GitHub: https://github.com/alexis14kl/browser-ipc-cdp
- npm: `browser-ipc-cdp`
- Local dev: `C:\Users\NyGsoft\Desktop\ipc`
- Version actual: 1.7.0
