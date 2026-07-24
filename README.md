# browser-ipc-cdp

[![Windows](https://img.shields.io/badge/Windows-0078D6?logo=windows&logoColor=white)](#) [![macOS](https://img.shields.io/badge/macOS-000000?logo=apple&logoColor=white)](#) [![Linux](https://img.shields.io/badge/Linux-FCC624?logo=linux&logoColor=black)](#) [![WSL](https://img.shields.io/badge/WSL-4D4D4D?logo=linux&logoColor=white)](#)
[![npm](https://img.shields.io/npm/v/browser-ipc-cdp?logo=npm&color=CB3837)](https://www.npmjs.com/package/browser-ipc-cdp) [![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

Control remoto de navegadores Chromium (Brave, Chrome, Edge) via IPC con CDP dinamico. Abre tu navegador real con todas tus sesiones, detecta o asigna puerto automaticamente, configura portproxy/firewall para WSL, y actualiza el MCP de Claude Code. Sin puertos fijos, sin hacks de registry, sin configuracion manual.

```bash
npm i browser-ipc-cdp
npx browser-ipc-cdp
```

Despues `/mcp` en Claude Code y listo. El wrapper resuelve el puerto dinamico solo, no hay que reescribir `.mcp.json` cuando cambia.

---

## Instalacion

`browser-ipc-cdp` se puede usar de **tres** formas. Elige la que prefieras.

### 1) npm — Claude Code (via npx)

```bash
npm i browser-ipc-cdp
npx browser-ipc-cdp
```

Luego `/mcp` en Claude Code para conectar el server `brave`. El instalador detecta/abre el navegador y configura el `.mcp.json` solo.

### 2) Plugin de Claude Code (desde git, sin npm)

Instalable directo desde este repo:

```
/plugin marketplace add alexis14kl/browser-ipc-cdp
/plugin install browser-ipc-cdp@browser-ipc-cdp
```

Reinicia Claude Code (o corre `/reload-plugins`) para que cargue el MCP del plugin. La primera llamada baja `chrome-devtools-mcp` con npx una sola vez (despues queda cacheado).

Funciona **tanto en el CLI de Claude Code como en la app de escritorio** (Ajustes -> Plugins -> Agregar marketplace, con `alexis14kl/browser-ipc-cdp` o la URL de git). Nota: el hosting de plugins de claude.ai rechaza un directorio `bin/` de nivel superior en la raiz del plugin (sus ejecutables entrarian al PATH sin aparecer en la superficie de aprobacion de admin), por eso el CLI vive en `cli.js` en la raiz y no en `bin/`.

### 3) Claude Desktop — extension `.mcpb` (un clic)

1. Descarga `browser-ipc-cdp.mcpb` desde [Releases](https://github.com/alexis14kl/browser-ipc-cdp/releases/latest).
2. En Claude Desktop: **Ajustes -> Extensiones** -> arrastra el archivo (o doble clic).
3. Configura el puerto del proxy (9333) y el overlay del cursor, y activa la extension.

Trae `chrome-devtools-mcp` **incluido** (no necesita npm ni npx) y usa el Node que trae Claude Desktop.

> **Nota:** no corras las tres a la vez contra el mismo navegador — todas usan el proxy en el puerto `9333` y colisionarian. Elige una por entorno (o cambia el puerto en la config del bundle/plugin).

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
browser-ipc-cdp lanza Brave (JS puro, sin dependencias externas)
        |
        v
  --remote-debugging-port=0  (OS asigna puerto aleatorio)
        |
        v
  Brave escribe DevToolsActivePort (archivo IPC)
        |
        v
  CdpService lee el puerto → guarda en cdp_info.json
        |
        v
  MCP "brave" (brave_mcp_launcher.js) lo resuelve on-demand
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
| `cli.js` | CLI instalador (`npx browser-ipc-cdp`): detecta/abre el navegador con CDP y configura el MCP |
| `brave_mcp_launcher.js` | Wrapper MCP que resuelve el puerto dinamico y lanza chrome-devtools-mcp detras del proxy |
| `src/services/browser-detect.js` | Deteccion y lanzamiento del navegador con CDP (JS puro, cross-platform) |
| `src/services/auto-launch.js` | Ultimo recurso del MCP: abre el navegador on-demand (JS, sin Python) |
| `src/services/cdp-proxy.js` | Proxy CDP en puerto fijo con re-resolucion on-demand y tunel WebSocket |
| `src/services/cursor-overlay.js` | Inyecta el cursor visual de la IA en cada pagina (v3.0.1, ON por defecto) |
| `cdp_info.json` | Se genera al ejecutar. Contiene puerto, WebSocket, modo, etc. |
| `README.md` | Este archivo |

---

## Como usar

### 1. Abrir Brave con CDP

```bash
# Tu Brave real (bookmarks, passwords, extensiones, todo) + configura el MCP
npx browser-ipc-cdp

# Forzar un navegador concreto
npx browser-ipc-cdp --browser brave   # o chrome / edge

# Perfil limpio separado (para testing, no toca tus datos)
npx browser-ipc-cdp --clean

# Puerto fijo en vez de dinamico
npx browser-ipc-cdp --port 9222
```

Todo es **JS puro** (Node ≥ 20.19), sin dependencias externas. El MCP tambien
abre el navegador solo (auto-launch) si no encuentra ninguno con CDP activo.

**Modos de perfil:**

| Comando | Perfil | Datos |
|---------|--------|-------|
| `npx browser-ipc-cdp` | **REAL** | Todos tus bookmarks, passwords, extensiones, sesiones activas |
| `npx browser-ipc-cdp --clean` | Limpio | Sesion vacia, sin datos personales |

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

Conecta con `/mcp` y tienes **67 tools** listas. Sin config extra.

---

## 82 Tools — Referencia completa

> `browser-ipc-cdp` expone el **CDP completo** de Chromium mas herramientas propias.
> Cada tool trabaja sobre tu navegador **real** con tus sesiones activas.

---

### Navegacion y Paginas

| Tool | Que hace |
|------|----------|
| `navigate_page` | Navega a una URL, recarga, avanza o retrocede |
| `list_pages` | Lista todas las pestanas abiertas con URL y titulo |
| `new_page` | Abre una nueva pestana |
| `close_page` | Cierra una pestana |
| `select_page` | Cambia el foco a una pestana especifica |
| `resize_page` | Cambia el tamano del viewport |
| `wait_for` | Espera a que aparezca un texto en la pagina |

---

### Vision — Screenshots y Snapshots

| Tool | Que hace |
|------|----------|
| `take_screenshot` | Captura el viewport o pagina completa (PNG/JPEG/WebP) |
| `take_snapshot` | Lee el contenido accesible de la pagina (para que la IA entienda la UI) |
| `print_to_pdf` | Exporta la pagina actual a un archivo PDF |

---

### Interaccion con la UI

| Tool | Que hace |
|------|----------|
| `click` | Hace click en un elemento por UID |
| `hover` | Mueve el mouse sobre un elemento |
| `drag` | Arrastra un elemento de origen a destino |
| `fill` | Escribe en un campo de texto |
| `fill_form` | Rellena multiples campos de un formulario de una vez |
| `type_text` | Escribe texto caracter por caracter (simula teclado real) |
| `press_key` | Presiona una tecla (Enter, Tab, Escape, flechas, etc.) |
| `upload_file` | Sube un archivo via input[type=file] |
| `handle_dialog` | Acepta o rechaza dialogs (alert, confirm, prompt) |
| `emulate` | Emula dispositivos moviles (iPhone, Android, viewport, user-agent) |

---

### JavaScript y DOM

| Tool | Que hace |
|------|----------|
| `evaluate_script` | Ejecuta JavaScript arbitrario en la pagina |
| `get_dom_element` | Busca elementos por selector CSS — devuelve atributos, textContent y HTML |
| `scroll_to` | Scroll a un elemento (selector CSS) o posicion (x/y), smooth o instant |
| `get_frames` | Lista todos los iframes del documento con su URL y jerarquia |
| `evaluate_in_frame` | Ejecuta JavaScript dentro de un iframe especifico |
| `get_accessibility_tree` | Devuelve el arbol de accesibilidad filtrado por rol e importancia |

---

### Storage del navegador

| Tool | Que hace |
|------|----------|
| `get_local_storage` | Lee todo el localStorage o una clave especifica |
| `set_local_storage` | Escribe un valor en localStorage |
| `get_session_storage` | Lee todo el sessionStorage o una clave especifica |
| `set_session_storage` | Escribe un valor en sessionStorage |
| `clear_storage` | Limpia localStorage, sessionStorage o ambos |
| `list_indexed_db` | Lista todas las bases IndexedDB y sus object stores |
| `get_indexed_db_data` | Lee registros de un object store con paginacion |

---

### Cookies

| Tool | Que hace |
|------|----------|
| `get_cookies` | Lee las cookies de la pagina actual (todas o por nombre/dominio) |
| `set_cookie` | Crea o actualiza una cookie con todos sus atributos |
| `delete_cookies` | Elimina cookies por nombre, dominio o URL |

---

### Red y Performance

| Tool | Que hace |
|------|----------|
| `list_network_requests` | Lista todas las requests de red capturadas |
| `get_network_request` | Detalla headers, body y timing de una request especifica |
| `emulate_network` | Simula condiciones de red: offline, 2G, 3G, 4G o custom |
| `block_urls` | Bloquea requests que coincidan con patrones de URL |
| `clear_browser_cache` | Limpia el cache HTTP del navegador — fuerza carga fresca |
| `set_extra_headers` | Agrega headers a TODAS las requests de la pagina (sin intercepcion) |
| `lighthouse_audit` | Ejecuta una auditoria Lighthouse (performance, SEO, accesibilidad) |
| `performance_start_trace` | Inicia una traza de performance CDP |
| `performance_stop_trace` | Detiene la traza y devuelve los datos |
| `performance_analyze_insight` | Analiza insights de performance de la pagina |
| `take_memory_snapshot` | Toma un snapshot del heap de memoria JavaScript |
| `monitor_network` | Sesion CDP persistente — captura todas las requests pasivamente a traves de navegaciones. Auto-inicia en primera llamada |
| `get_request_body` | Obtiene headers, body del request y body de la respuesta de una request especifica (por URL o requestId de `monitor_network`) |

---

### Consola y Debug

| Tool | Que hace |
|------|----------|
| `list_console_messages` | Lista mensajes de consola (snapshot puntual via chrome-devtools-mcp) |
| `get_console_message` | Lee un mensaje de consola especifico con detalles |
| `monitor_console` | Sesion CDP persistente — acumula mensajes a traves de navegaciones. Auto-inicia en primera llamada |
| `get_console_entry` | Lee una entrada especifica del buffer de `monitor_console` por indice |

---

### Emulacion del entorno

| Tool | Que hace |
|------|----------|
| `set_geolocation` | Sobreescribe la ubicacion GPS del navegador |
| `grant_permissions` | Otorga permisos sin popup (camara, mic, notificaciones, geolocalizacion) |
| `set_download_path` | Controla donde se guardan los archivos descargados |
| `ignore_cert_errors` | Ignora errores de certificado HTTPS (certs autofirmados) |

---

### Cobertura de Codigo

| Tool | Que hace |
|------|----------|
| `start_js_coverage` | Inicia coleccion de cobertura JavaScript (que funciones se ejecutaron) |
| `stop_js_coverage` | Detiene y devuelve resultados — muestra % de cobertura por script |
| `start_css_coverage` | Inicia tracking de reglas CSS utilizadas |
| `stop_css_coverage` | Detiene y devuelve reglas CSS no utilizadas — detecta dead CSS |

---

### Intercepcion de requests

| Tool | Que hace |
|------|----------|
| `setup_request_interception` | Activa reglas de intercepcion. Acciones: `mock`, `block`, `redirect`, `delay`, `pass`, `add_headers`, `modify_response` |
| `get_intercepted_requests` | Lee todas las requests capturadas con URL, metodo, payload y headers |
| `clear_request_interception` | Detiene la intercepcion y elimina todas las reglas |

> **`modify_response`** — intercepta la respuesta REAL del servidor y la modifica antes de que llegue al frontend. Usa `jsonPatch` para sobreescribir campos del JSON o `replaceBody` para reemplazar el body entero.

---

### Advanced Testing Tools — Para QA de alto nivel

> Estas tools son atajos semanticos sobre el sistema de intercepcion.
> Diseñadas para testers avanzados que necesitan velocidad y precision.

| Tool | Caso de uso |
|------|-------------|
| `mock_api` | Responde un endpoint con JSON sintetico — testea UI sin backend real |
| `block_resources` | Bloquea imagenes / ads / analytics / fonts / scripts por categoria |
| `inject_error` | Fuerza un HTTP 500/404/401 en un endpoint — chaos testing |
| `capture_payloads` | Captura el body de los POST sin alterar el request — debug de formularios |
| `add_auth_header` | Inyecta `Authorization: Bearer TOKEN` en flight — sin tocar el codigo |
| `redirect_to_local` | Redirige `https://prod.api.com/*` → `http://localhost:3000` — frontend prod vs backend local |
| `throttle_api` | Agrega latencia artificial a un endpoint — testea loading states y skeletons |

---

### Seguridad y Pentesting

> Tools ofensivas/defensivas que operan a nivel CDP — por debajo del sandbox JavaScript.
> Requieren uso responsable y autorizado. Ver seccion **Uso responsable**.

#### Reconocimiento (Reconnaissance)

| Tool | Que hace |
|------|----------|
| `security_audit_headers` | Audita headers HTTP de seguridad (CSP, HSTS, X-Frame-Options, CORS). Califica cada header A-F y lista malas configuraciones |
| `detect_third_party_scripts` | Mapea todos los scripts, iframes y estilos de terceros. Clasifica servicios conocidos (Analytics, CDN, Ads) y detecta terceros desconocidos — superficie de ataque de supply chain |
| `analyze_network_waterfall` | Analiza el waterfall de recursos con PerformanceResourceTiming. Detecta mixed content (HTTP en HTTPS), recursos lentos, requests cross-origin y desglose de protocolo |
| `stealth_check` | Detecta 13 senales de fingerprint de automatizacion CDP/Playwright/Puppeteer/Selenium que usan los sistemas anti-bot. Reporta riesgo de deteccion |

#### Evasion y Bypass (Offensive)

| Tool | Que hace |
|------|----------|
| `bypass_csp` | Activa/desactiva la aplicacion de CSP via `Page.setBypassCSP`. Ignora `script-src`, `connect-src` y demas directivas — permite `eval()`, scripts inline y cargas cross-origin sin restriccion |
| `spoof_webdriver` | Parchea `navigator.webdriver` → `undefined` mediante sesion CDP persistente (CdpStealth). Sobrevive navegaciones porque el WebSocket se mantiene abierto. Verificar con `stealth_check` |
| `extract_http_only_cookies` | Extrae cookies HttpOnly inaccesibles a JavaScript. Usa `Network.getCookies` CDP que bypasea el sandbox JS. Clasifica por rol (sesion, auth, CSRF, tracking) y exporta en formato Netscape para curl/Burp/httpx |
| `spoof_fingerprint` | Spoofing multi-capa: UA, plataforma, vendor, idioma, pantalla, devicePixelRatio y WebGL. Presets: `mobile-android`, `mobile-ios`, `desktop-windows`, `desktop-mac`, `desktop-linux` |

#### MitM Local y Fuzzing

> Requieren uso responsable y autorizado en entornos controlados.

| Tool | Que hace |
|------|----------|
| `network_intercept_modify` | MitM real via `Fetch.enable` + `Fetch.requestPaused`. Pausa y modifica requests/responses en vuelo: headers, body, URL, metodo, status, inyeccion de `<script>`, jsonPatch. Mas moderno que `setup_request_interception` (usa Fetch domain, no Network deprecated) |
| `replay_request` | Replay de requests desde el contexto de la pagina (`Runtime.evaluate + fetch()`), preservando sesion viva, cookies y tokens CSRF. Soporta fuzzing con `{{PLACEHOLDER}}` en URL/body/headers |
| `analyze_third_party_risk` | Audit de supply chain: enumera terceros, inyecta MutationObserver para detectar scripts cargados dinamicamente, analiza scripts inline buscando senales de ofuscacion (`eval`, `atob`, `fromCharCode`, hex escapes, `Function(string)`) |

---

### Ejemplos rapidos

```
# Ver que tabs hay abiertas
mcp__brave__list_pages

# Ir a Google con tu sesion real
mcp__brave__navigate_page { url: "https://google.com" }

# Screenshot del estado actual
mcp__brave__take_screenshot

# Scroll a un elemento
mcp__brave__scroll_to { selector: "#footer" }
mcp__brave__scroll_to { y: 1200, behavior: "smooth" }

# Mockear una API para testear sin backend
mcp__brave__mock_api {
  urlPattern: "*/api/users*",
  responseBody: [{ id: 1, name: "Test User" }]
}

# Modificar respuesta real del servidor (cambiar role sin tocar backend)
mcp__brave__setup_request_interception {
  rules: [{
    name: "elevate-role",
    urlPattern: "*/api/me*",
    action: "modify_response",
    jsonPatch: { "role": "admin", "permissions.write": true }
  }]
}

# Bloquear todo el tracking y ads
mcp__brave__block_resources { categories: ["analytics", "ads"] }

# Testear como responde tu UI a un error 500
mcp__brave__inject_error { urlPattern: "*/api/checkout*", statusCode: 500 }

# Agregar token a todas las requests sin interceptar
mcp__brave__set_extra_headers { headers: { "Authorization": "Bearer mi-token-aqui" } }

# Simular conexion 3G
mcp__brave__emulate_network { preset: "3g" }

# Limpiar cache antes de test de performance
mcp__brave__clear_browser_cache

# Medir cobertura JS de un flujo
mcp__brave__start_js_coverage
# ... hacer acciones en la pagina ...
mcp__brave__stop_js_coverage { minCoverage: 80 }

# Detectar CSS no utilizado
mcp__brave__start_css_coverage
# ... navegar la pagina ...
mcp__brave__stop_css_coverage { unusedOnly: true }

# Exportar la pagina a PDF
mcp__brave__print_to_pdf { path: "C:/output/reporte.pdf" }

# Ver el localStorage de la app
mcp__brave__get_local_storage

# Leer el arbol de accesibilidad
mcp__brave__get_accessibility_tree { depth: 3 }
```

---

## Casos de uso QA — Flujos completos

> Cada bloque es un flujo end-to-end que puedes pedirle a Claude directamente.
> El agente de IA ejecuta los tools en secuencia, correlaciona resultados y reporta.

---

### 1. Smoke test de un flujo de login

```
Objetivo: verificar que login funciona y persiste sesión correctamente.

1. navigate_page      → ir a /login
2. fill_form          → usuario + contraseña
3. click              → botón Ingresar
4. wait_for           → texto "Bienvenido" o dashboard
5. take_screenshot    → evidencia visual
6. get_cookies        → verificar cookie de sesión presente (HttpOnly, Secure)
7. get_local_storage  → verificar token guardado (si aplica)
```

---

### 2. Test de manejo de errores HTTP (Chaos Testing)

```
Objetivo: verificar que la UI responde correctamente a errores del servidor.

1. navigate_page  → ir a la sección a testear
2. inject_error   → urlPattern "*/api/productos*", statusCode 500
3. click / fill   → ejecutar la acción que dispara la petición
4. wait_for       → mensaje de error en UI ("Algo salió mal", toast, etc.)
5. take_screenshot → evidencia del estado de error
6. inject_error   → statusCode 404  (repetir con distintos códigos)
7. inject_error   → statusCode 401  (verificar redirect a login)
8. clear_request_interception → limpiar
```

---

### 3. Test de integración API — frontend vs backend real

```
Objetivo: comparar comportamiento de UI con backend real vs respuesta mockeada.

# Con backend real
1. navigate_page + monitor_network  → capturar requests reales
2. get_request_body                 → ver payload exacto que envía el frontend
3. capture_payloads                 → ver todos los POST bodies

# Con backend mockeado (aislar frontend)
4. mock_api { urlPattern: "*/api/*", responseBody: {...} }
5. navegar y ejecutar flujo         → la UI recibe datos sintéticos
6. take_screenshot                  → comparar con estado real
```

---

### 4. Test de performance y cobertura de código

```
Objetivo: medir qué código JS/CSS realmente se usa en un flujo y dónde están los cuellos de botella.

1. clear_browser_cache              → test desde cero
2. start_js_coverage + start_css_coverage
3. performance_start_trace
4. navigate_page → ejecutar flujo completo (login → acción principal → logout)
5. performance_stop_trace           → ver eventos, long tasks, layout thrashing
6. stop_js_coverage { minCoverage: 70 }  → funciones no ejecutadas = dead code
7. stop_css_coverage { unusedOnly: true } → reglas CSS sin uso = CSS muerto
8. analyze_network_waterfall        → recursos lentos, mixed content, protocolos
9. take_memory_snapshot             → detectar memory leaks post-flujo
```

---

### 5. Test de accesibilidad (a11y)

```
Objetivo: verificar que la UI es accesible y no rompe AT (lectores de pantalla).

1. navigate_page          → ir a la página a auditar
2. get_accessibility_tree { depth: 4 }  → ver jerarquía ARIA real
3. lighthouse_audit       → score accesibilidad + lista de violaciones
4. evaluate_script        → document.querySelectorAll('[role]') para ver roles
5. get_dom_element        → verificar aria-label, aria-describedby en inputs clave
```

---

### 6. Test de estado del cliente (Storage QA)

```
Objetivo: verificar que la app guarda y limpia el estado correctamente.

# Pre-flujo
1. get_local_storage / get_session_storage / get_cookies  → baseline vacío

# Después de login
2. get_cookies        → sesión establecida
3. get_local_storage  → tokens/preferencias guardados

# Después de logout
4. get_cookies        → cookie de sesión eliminada
5. get_local_storage  → estado limpio
6. get_session_storage → limpio

# IndexedDB (apps con cache offline)
7. list_indexed_db    → ver bases y object stores
8. get_indexed_db_data → verificar registros sincronizados
```

---

### 7. Test multi-dispositivo (Device Emulation)

```
Objetivo: verificar comportamiento en móvil sin dispositivo físico.

1. emulate { device: "iPhone 14" }     → viewport + UA + touch
2. navigate_page                        → cargar la app
3. take_screenshot                      → ver layout mobile
4. emulate_network { preset: "3g" }    → simular red lenta
5. navigate_page                        → medir tiempo de carga real en 3G
6. analyze_network_waterfall            → identificar recursos que bloquean render
7. emulate { restore: true }           → volver a desktop
```

---

### 8. QA de seguridad (Security QA)

```
Objetivo: verificar hardening básico de la app antes de release.

1. navigate_page + security_audit_headers  → CSP, HSTS, X-Frame-Options, CORS
2. detect_third_party_scripts              → scripts de terceros no autorizados
3. analyze_third_party_risk { waitMs: 3000 } → scripts dinámicos + ofuscación
4. extract_http_only_cookies               → verificar cookies marcadas HttpOnly + Secure
5. stealth_check                           → fingerprint de automatización visible

# Verificar que la app NO filtra datos en error responses
6. inject_error { urlPattern: "*/api/*", statusCode: 500 }
7. monitor_network → revisar que el body del error no exponga stack traces / paths internos
```

---

### 9. Fuzzing de parámetros con sesión viva

```
Objetivo: testear validaciones del backend con inputs malformados, manteniendo auth.

1. navigate_page + login  → establecer sesión real
2. replay_request {
     url: "https://app.com/api/search",
     method: "POST",
     body: '{"query":"{{INPUT}}"}',
     fuzz: {
       INPUT: ["normal", "", "' OR 1=1--", "<script>alert(1)</script>", "A".repeat(5000)]
     }
   }
3. Analizar respuestas: status 400=validado, 500=crash, 200 con datos = posible SQLi
```

---

### 10. MitM local — modificar respuesta del servidor en tiempo real

```
Objetivo: testear cómo reacciona el frontend a datos manipulados sin tocar el backend.

1. network_intercept_modify { action: "start" }
2. network_intercept_modify {
     action: "add_rule",
     urlPattern: "*/api/user*",
     stage: "response",
     responseModifications: {
       jsonPatch: [
         { op: "set", path: "/role",        value: "superadmin" },
         { op: "set", path: "/permissions", value: ["read","write","delete","admin"] }
       ]
     }
   }
3. navigate_page → cargar el perfil del usuario
4. take_screenshot → ver si la UI muestra opciones de admin (privilege escalation test)
5. network_intercept_modify { action: "stop" }
```

---

### 11. Monitoreo continuo de consola y red (debug en CI)

```
Objetivo: ejecutar un flujo completo y capturar TODOS los errores sin intervención manual.

1. monitor_console   → activar captura de logs (persiste entre navegaciones)
2. monitor_network   → activar captura de requests
3. [ejecutar flujo completo: login → navegación → acción → logout]
4. monitor_console   → buscar errores/warnings
5. monitor_network   → buscar requests fallidas (status >= 400), requests lentas
6. get_request_body  → ver body completo de cualquier request sospechosa
```

---

### 12. Inyección de script en respuestas HTML (red team / XSS verification)

```
Objetivo: verificar si la app ejecuta scripts inyectados en respuestas (XSS stored/reflected).

1. network_intercept_modify { action: "start" }
2. network_intercept_modify {
     action: "add_rule",
     urlPattern: "*/dashboard*",
     stage: "response",
     responseModifications: {
       injectScript: "window.__xssVerified = true; console.log('XSS payload ejecutado');"
     }
   }
3. navigate_page → /dashboard
4. evaluate_script → "window.__xssVerified"  # true = CSP no bloquea scripts inyectados
5. list_console_messages → verificar log del payload
6. bypass_csp { enabled: false }  # si hay CSP, desactivar para comparar
```

---

## Actualizacion y desinstalacion

El instalador se auto-copia a una **ruta fija** (`~/.browser-ipc-cdp/app`) y
las configs MCP apuntan ahi — nunca al cache volatil de npx. Actualizar:

```bash
npx -y browser-ipc-cdp@latest
```

Eso reemplaza el contenido de la ruta fija con swap atomico: **lo viejo se
borra por completo** (incluidos archivos que la version nueva ya no trae) y
lo nuevo queda. Luego reconecta con `/mcp` en Claude Code para que el proceso
MCP corra la version nueva.

Ademas, tanto el CLI como el launcher MCP avisan si hay una version mas nueva
en npm (chequeo best-effort contra el registry; sin red no molesta). El
launcher loguea siempre su version a stderr (`[brave-mcp] browser-ipc-cdp vX.Y.Z`)
para que sea obvio que version esta corriendo la IA.

Desinstalar (borra la ruta fija y quita la entrada `brave` de los
`.mcp.json`/`.claude.json` conocidos):

```bash
npx -y browser-ipc-cdp --uninstall
```

Modo desarrollo: si ejecutas el instalador desde un checkout git del repo, no
se crea copia fija — las configs apuntan al repo (flujo `npm link` intacto).

---

## Que es IPC?

**Inter-Process Communication** — `browser-ipc-cdp` se comunica con Brave sin usar la red: lanza el navegador con `--remote-debugging-port=0` y lee el puerto que el propio Brave escribe en el archivo `DevToolsActivePort`.

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
| No encuentra Brave | Verificar ruta: `C:\Program Files\BraveSoftware\Brave-Browser\Application\brave.exe` (o usar `--browser chrome`/`edge`) |
| Puerto no detectado | Brave tarda en escribir DevToolsActivePort. Esperar 10s y reintentar |
| MCP "brave" no conecta | Verificar el proxy: `curl http://127.0.0.1:9333/json/version`. Si responde 502, el navegador no tiene CDP activo: relanzar con `npx browser-ipc-cdp` o dejar que el auto-launch lo abra |
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
real del navegador y cambia en cada arranque. Nota: tanto el CLI como cada
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
   en JS puro) y el proxy :9333 re-resuelve el puerto en cada conexion.

Opcional (manual):
   npx browser-ipc-cdp          # abrir el navegador con CDP dinamico a mano
   npx browser-ipc-cdp --clean  # perfil limpio para testing
```

> En WSL ademas hace falta el portproxy + firewall de la seccion
> "Conexion desde WSL" (el instalador los configura solo).
