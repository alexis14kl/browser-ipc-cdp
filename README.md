# browser-ipc-cdp

Control remoto de navegadores Chromium (Brave, Chrome, Edge) via IPC con CDP dinamico. Abre tu navegador real con todas tus sesiones, detecta o asigna puerto automaticamente, configura portproxy/firewall para WSL, y actualiza el MCP de Claude Code. Sin puertos fijos, sin hacks de registry, sin configuracion manual.

```bash
npm i browser-ipc-cdp
npx browser-ipc-cdp
```

Despues `/mcp` en Claude Code y listo. El wrapper resuelve el puerto dinamico solo, no hay que reescribir `.mcp.json` cuando cambia.

---

## Por que usarlo

- **Mantiene tus sesiones reales**: cookies, 2FA, extensiones, tabs abiertas — nada se pierde
- **Pasa Cloudflare sin captcha**: usa tu cookie `cf_clearance` ya validada, no parece bot
- **Cross-browser**: Brave, Chrome, Edge, Chromium
- **Puerto dinamico**: cero conflictos, OS asigna puerto libre via DevToolsActivePort IPC
- **Auto-config WSL**: portproxy + firewall + .mcp.json sin pasos manuales
- **DevTools completo**: Network, Console, Performance, Lighthouse, Coverage, Heap snapshots

---

## Acceso completo a Red (CDP)

`browser-ipc-cdp` expone el subsistema **Network** del navegador. Cualquier request HTTP/HTTPS, WebSocket, XHR o fetch se puede observar, interceptar, modificar o bloquear.

| Capacidad | Metodo CDP |
|-----------|------------|
| Listar requests | `Network.requestWillBeSent` |
| Leer body response | `Network.getResponseBody` |
| Modificar headers | `Network.setExtraHTTPHeaders` |
| Bloquear URLs (ads/tracking) | `Network.setBlockedURLs` |
| Mock responses | `Fetch.fulfillRequest` |
| Interceptar requests | `Fetch.requestPaused` |
| Throttling (3G/offline) | `Network.emulateNetworkConditions` |
| Cookies CRUD | `Network.getCookies` / `setCookie` / `deleteCookies` |
| Espiar WebSockets | `Network.webSocketFrameSent/Received` |
| Auth challenge | `Fetch.authRequired` |

**[📖 Documentacion completa de Network + ejemplos](docs/CDP_NETWORK.md)**

---

## ⚠️ Uso responsable

Esta herramienta esta destinada a **testing personal, automatizacion propia y desarrollo**. El usuario es responsable de:

- Usarla solo en navegadores y cuentas que le pertenecen
- Cumplir con los Terms of Service de los sitios que automatice
- Respetar leyes locales sobre privacidad y acceso a sistemas

**NO se autoriza el uso para:**

- Acceso no autorizado a sistemas ajenos
- Scraping que viole ToS de un servicio
- Bypass de protecciones de seguridad sin permiso del owner
- Automatizacion de cuentas de terceros sin consentimiento

Distribuida bajo licencia **MIT** — el autor (`Alexis Malambo`) no se hace responsable del mal uso por terceros (clausula `AS IS, WITHOUT WARRANTY OF ANY KIND`).

---

## 💖 Apoya el proyecto

Cree `browser-ipc-cdp` como solucion de IA para **mantener tus sesiones reales activas** y que un asistente (Claude Code) pueda controlar tu navegador via el **MCP de Brave** — sin perder cookies, 2FA ni extensiones.

Es software libre (MIT) y lo mantengo en mi tiempo. Si te sirvio o te ahorro trabajo, podes invitarme un cafe:

[![Donar con PayPal](https://img.shields.io/badge/Donar-PayPal-00457C?logo=paypal&logoColor=white&style=for-the-badge)](https://www.paypal.com/donate/?business=rapalexism@gmail.com&no_recurring=0&item_name=Apoyo+a+browser-ipc-cdp&currency_code=USD)

👉 **[paypal.com/donate → rapalexism@gmail.com](https://www.paypal.com/donate/?business=rapalexism@gmail.com&no_recurring=0&item_name=Apoyo+a+browser-ipc-cdp&currency_code=USD)**

Cualquier aporte ayuda a seguir mejorando el proyecto. Gracias! 🙌

---

# Documentacion

## Que es esto?

Sistema para controlar **tu Brave Browser real** (con todos tus datos, bookmarks, passwords, extensiones y sesiones) desde Claude Code via **IPC (Inter-Process Communication)** + **CDP (Chrome DevTools Protocol)** con puerto dinamico.

**Sin puerto fijo, sin sesion separada, sin perder tus datos. Tu Brave de uso diario controlado por IA.**

---

## Arquitectura

```
brave_ipc.py lanza Brave
        |
        v
  --remote-debugging-port=0  (OS asigna puerto aleatorio)
        |
        v
  Brave escribe DevToolsActivePort (archivo IPC)
        |
        v
  brave_ipc.py lee el puerto → guarda en cdp_info.json
        |
        v
  MCP "brave" (brave_mcp_launcher.js) lee cdp_info.json
        |
        v
  Claude Code usa mcp__brave__* para controlar el navegador
```

### Proxy CDP dinamico (v2.3.0+)

El launcher ya no pasa el puerto del navegador directo a chrome-devtools-mcp.
Levanta un **proxy local en puerto fijo** (default `9333`) y chrome-devtools-mcp
apunta siempre ahi:

```
chrome-devtools-mcp ──> http://127.0.0.1:9333 (proxy, puerto FIJO)
                              |
                              v  re-resuelve el puerto real EN CADA conexion
                        Brave/Chrome en :54xxx (cambia en cada reinicio)
```

Esto elimina el problema clasico: el puerto se resolvia UNA vez al arrancar el
MCP, y si el navegador arrancaba despues (o se reiniciaba con `port=0`, que da
puerto nuevo cada vez) el MCP quedaba apuntando a un puerto muerto hasta
reiniciarlo. Con el proxy, la siguiente llamada re-resuelve sola: no hay que
reiniciar el MCP nunca por cambio de puerto, y el cliente (la IA) solo conoce
UN puerto que no cambia.

- `BROWSER_CDP_PROXY_PORT` cambia el puerto fijo (default 9333; si esta ocupado prueba los siguientes).
- `BROWSER_CDP_NO_PROXY=1` desactiva el proxy (comportamiento legacy).
- `BROWSER_CDP_EXTRA_PROFILES` User Data dirs extra donde buscar `DevToolsActivePort` (separados por `;` `:` `,`).
- `BROWSER_CDP_CURSOR=0` apaga el overlay del cursor (encendido por defecto desde v3.0.1).
- Diagnostico: `browser-ipc-cdp-mcp --resolve-only` (imprime el puerto resuelto) y `--proxy-only` (solo el proxy, sin MCP).

Mejoras v2.3.1:

- **Handshake MCP no bloqueante**: el launcher ya no espera el auto-launch del
  navegador (hasta 60s) antes de arrancar chrome-devtools-mcp. Si el navegador
  esta corriendo sin `--remote-debugging-port`, antes el cliente MCP cortaba por
  timeout (30s en Claude Code); ahora el MCP arranca al instante y el navegador
  se resuelve/lanza en background, on-demand via el proxy.
- **Reclamo del puerto fijo**: cada proxy responde con el header
  `x-cdp-proxy: browser-ipc-cdp`. Si al arrancar el puerto 9333 lo ocupa un
  proxy huerfano de una sesion anterior, el nuevo lo detecta por ese header, lo
  mata y toma el puerto — el puerto fijo se mantiene fijo (antes caia a 9334).

Mejoras v3.0.x:

- **Arquitectura MVC** (`src/`): `platform/` (Strategy por OS: win/darwin/linux/wsl),
  `services/` (cdp-service, cdp-proxy, auto-launch, browser-detect, cursor-overlay),
  `controllers/` (cli, mcp) y `views/` (logger, cdp-info). Una sola implementacion
  de cada cosa; el CLI y el MCP consumen los mismos servicios.
  Ver [docs/ARQUITECTURA-MVC.md](docs/ARQUITECTURA-MVC.md).
- **Cursor overlay (v3.0.1)**: el MCP inyecta un cursor visual en todas las
  paginas para ver donde hace click la IA. ENCENDIDO por defecto; se apaga con
  `BROWSER_CDP_CURSOR=0`. Best-effort: si falla, el MCP sigue igual.

---

## Archivos

| Archivo | Funcion |
|---------|---------|
| `brave_ipc.py` | Launcher principal. Abre Brave con CDP dinamico via IPC |
| `brave_cdp.bat` | Doble-click para ejecutar brave_ipc.py |
| `brave_mcp_launcher.js` | Wrapper MCP que resuelve el puerto dinamico y lanza chrome-devtools-mcp detras del proxy |
| `src/services/cdp-proxy.js` | Proxy CDP en puerto fijo con re-resolucion on-demand y tunel WebSocket |
| `src/services/cursor-overlay.js` | Inyecta el cursor visual de la IA en cada pagina (v3.0.1, ON por defecto) |
| `cdp_info.json` | Se genera al ejecutar. Contiene puerto, WebSocket, PID, etc. |
| `README.md` | Este archivo |

---

## Como usar

### 1. Abrir Brave con CDP

```bat
:: Tu Brave real (bookmarks, passwords, extensiones, todo)
python brave_ipc.py

:: Perfil limpio separado (para testing)
python brave_ipc.py --clean

:: Mas opciones
python brave_ipc.py --port 9222       # Puerto fijo
python brave_ipc.py --url https://..  # Abre URL al iniciar
python brave_ipc.py --headless        # Sin ventana visible
python brave_ipc.py --no-kill         # No mata Brave existente
```

**Modos de perfil:**

| Comando | Perfil | Datos |
|---------|--------|-------|
| `python brave_ipc.py` | **REAL** | Todos tus bookmarks, passwords, extensiones, sesiones activas |
| `python brave_ipc.py --clean` | Limpio | Sesion vacia, sin datos personales |

### 2. Verificar CDP

Despues de ejecutar, el script muestra:
```
  Navegador:  Chrome/146.0.7680.80
  Puerto CDP: 58553
  CDP URL:    http://127.0.0.1:58553
  WebSocket:  ws://127.0.0.1:58553/devtools/browser/...
```

Tambien puedes verificar manualmente:
```
http://127.0.0.1:{PUERTO}/json/version   → Info del navegador
http://127.0.0.1:{PUERTO}/json/list      → Pestanas abiertas
```

### 3. Conectar desde Claude Code

El instalador (`npx browser-ipc-cdp`) configura el MCP "brave" automaticamente.
Tambien puedes hacerlo a mano en `.mcp.json`:
```json
{
  "mcpServers": {
    "brave": {
      "command": "npx",
      "args": ["-y", "-p", "browser-ipc-cdp", "browser-ipc-cdp-mcp"]
    }
  }
}
```

> El `-p browser-ipc-cdp` es obligatorio si el paquete no esta instalado
> (global o local): `browser-ipc-cdp-mcp` es el nombre del bin, no del paquete.
>
> El wrapper resuelve el puerto dinamico solo (via el proxy fijo `:9333`):
> **no hay que actualizar `.mcp.json` cuando cambia el puerto del navegador.**
> Si el navegador no esta abierto, el MCP arranca igual y lo lanza on-demand
> en la primera tool call.

### 4. Usar desde Claude Code

```
mcp__brave__list_pages          → Ver pestanas abiertas
mcp__brave__navigate_page       → Navegar a URL
mcp__brave__take_snapshot       → Leer contenido de la pagina
mcp__brave__take_screenshot     → Captura de pantalla
mcp__brave__click               → Click en elemento
mcp__brave__fill                → Escribir en campo de texto
mcp__brave__press_key           → Presionar tecla
mcp__brave__evaluate_script     → Ejecutar JavaScript
mcp__brave__list_network_requests → Ver requests de red
```

---

## Que es IPC?

**Inter-Process Communication** — un proceso (brave_ipc.py) se comunica con otro (Brave) sin usar la red.

### Flujo tradicional (malo):
```
Abrir Brave con --remote-debugging-port=9222
  → Puerto fijo → conflictos
  → Necesita regla de firewall
  → Necesita portproxy para WSL
```

### Flujo IPC (bueno):
```
Proceso padre lanza Brave con --remote-debugging-port=0
  → OS asigna puerto aleatorio (ej: 58553)
  → Brave escribe puerto en DevToolsActivePort (IPC via filesystem)
  → Proceso padre lee el archivo → sabe el puerto
  → Conexion directa, sin firewall, sin conflictos
```

### Por que puerto 0?

Cuando pasas `--remote-debugging-port=0`, le dices al sistema operativo:
"dame cualquier puerto disponible". El OS elige uno libre (ej: 58553, 62301, etc.)
y Brave lo escribe en `DevToolsActivePort` para que otros procesos lo lean.

Es el mismo patron que usa:
- **Playwright** internamente
- **Puppeteer** internamente
- **El bot de publicidad** con DiCloak (inject hook → puerto dinamico)

---

## Que es CDP?

**Chrome DevTools Protocol** — protocolo para controlar navegadores Chromium
(Chrome, Brave, Edge, Opera, ginsbrowser) programaticamente.

Permite:
- Navegar a URLs
- Hacer click, escribir, scroll
- Tomar screenshots
- Ejecutar JavaScript
- Interceptar requests de red
- Leer el DOM completo

---

## Conexion desde WSL

WSL no puede acceder a `127.0.0.1` de Windows directamente.
Para que Claude Code (WSL) llegue a Brave (Windows):

1. **Portproxy** (configuracion unica como Admin):
```powershell
netsh interface portproxy add v4tov4 listenaddress=0.0.0.0 listenport=58553 connectaddress=127.0.0.1 connectport=58553
```

2. **Firewall** (rango dinamico, configuracion unica):
```powershell
netsh advfirewall firewall add rule name="CDP Dynamic Range" dir=in action=allow protocol=TCP localport=50000-65000
```

3. **IP de Windows** desde WSL:
```bash
grep nameserver /etc/resolv.conf
# Resultado: 172.20.176.1 (puede cambiar entre reinicios)
```

---

## Troubleshooting

| Problema | Solucion |
|----------|----------|
| `brave_ipc.py` no encuentra Brave | Verificar ruta: `C:\Program Files\BraveSoftware\Brave-Browser\Application\brave.exe` |
| Puerto no detectado | Brave tarda en escribir DevToolsActivePort. Esperar 10s y reintentar |
| MCP "brave" no conecta | Verificar el proxy: `curl http://127.0.0.1:9333/json/version`. Si responde 502, el navegador no tiene CDP activo: relanzar con `brave_ipc.py` o dejar que el auto-launch lo abra |
| WSL no llega al puerto | Agregar portproxy + firewall (ver seccion anterior) |
| IP de Windows cambio | `grep nameserver /etc/resolv.conf` → actualizar `.mcp.json` |
| Brave ya estaba abierto | Usar `--no-kill` o cerrar Brave antes de ejecutar |

---

## cdp_info.json (ejemplo)

```json
{
  "DEBUG_PORT": 55610,
  "DEBUG_WS": "ws://127.0.0.1:55610/devtools/browser/...",
  "BROWSER": "Chrome/150.0.7871.128",
  "CDP_URL": "http://127.0.0.1:9333",
  "BACKEND_URL": "http://127.0.0.1:55610",
  "MODE": "PROXY",
  "UPDATED_AT": "2026-07-18T20:41:41.714Z"
}
```

Otros scripts deben usar `CDP_URL`: con `MODE: "PROXY"` apunta al proxy fijo,
que sigue valido aunque el navegador se reinicie. `BACKEND_URL` es el puerto
real del navegador y cambia en cada arranque. Nota: `brave_ipc.py` y cada
instancia del MCP escriben este archivo; con varias sesiones concurrentes el
contenido refleja la ultima que escribio.

---

## Ejemplo real: que puedes hacer

Con tu Brave real conectado via IPC + CDP, Claude Code puede:

- **Ver todas tus tabs abiertas** (Jira, WhatsApp, Facebook, n8n, ChatGPT, etc.)
- **Navegar a cualquier pagina** en tu sesion logueada
- **Leer contenido de paginas** donde ya estas autenticado (Jira, n8n, etc.)
- **Hacer click, escribir, buscar** en cualquier tab
- **Tomar screenshots** de lo que ves
- **Ejecutar JavaScript** en cualquier pagina
- **Interceptar network requests** para debug

Todo sin necesidad de login adicional — usa tus sesiones activas.

---

## Flujo completo paso a paso

```
1. Instalar (una sola vez):
   npx browser-ipc-cdp          # detecta el navegador y configura el MCP "brave"

2. En Claude Code: /mcp → brave conectado

3. Listo! Claude Code controla tu navegador real.
   Si no estaba abierto, la primera tool call lo lanza sola (auto-launch
   via brave_ipc.py) y el proxy :9333 re-resuelve el puerto en cada conexion.

Opcional (manual):
   python brave_ipc.py          # abrir el navegador con CDP dinamico a mano
   python brave_ipc.py --clean  # perfil limpio para testing
```

> En WSL ademas hace falta el portproxy + firewall de la seccion
> "Conexion desde WSL" (el instalador los configura solo).
