# Acceso a Red Completo via CDP

`browser-ipc-cdp` te da acceso al subsistema **Network** completo del navegador a traves del **Chrome DevTools Protocol (CDP)**. Cualquier request HTTP/HTTPS, WebSocket, XHR, fetch, navegacion, descarga o redirect que pase por el navegador se puede observar, interceptar, modificar o bloquear desde Claude Code o tu propio script.

> Esta capacidad esta disponible una vez que `npx browser-ipc-cdp` configura el puerto CDP dinamico y `.mcp.json` apunta al wrapper Node. Despues, cualquier herramienta que hable CDP (chrome-devtools-mcp, Playwright, Puppeteer, scripts custom) tiene acceso completo.

---

## Tabla de capacidades

| Capacidad | Metodo CDP | Uso tipico |
|-----------|------------|------------|
| Listar requests | `Network.requestWillBeSent` event | Log de todo el trafico |
| Ver response status + headers | `Network.responseReceived` event | Debug API |
| Leer body response | `Network.getResponseBody` | Scrape JSON/HTML |
| Modificar headers | `Network.setExtraHTTPHeaders` | Agregar auth, faker User-Agent |
| Bloquear URLs | `Network.setBlockedURLs` | Bloquear ads/tracking |
| Mock responses | `Fetch.fulfillRequest` | Test con APIs fake |
| Interceptar antes de enviar | `Fetch.requestPaused` | Modificar body, redirect |
| Throttling | `Network.emulateNetworkConditions` | Simular 3G/offline |
| Cookies CRUD | `Network.getCookies` / `setCookie` / `deleteCookies` | Session manipulation |
| WebSockets | `Network.webSocketFrameSent/Received` | Espiar mensajes WS |
| Cache control | `Network.setCacheDisabled` | Forzar requests frescos |
| Auth challenge | `Fetch.authRequired` | Inyectar credentials HTTP |

---

## Casos de uso practicos

### 1. Capturar todos los XHR/fetch a API endpoints

```javascript
const apis = events.filter(e =>
  e.type === 'Fetch' || e.type === 'XHR'
);
```

Cada `requestWillBeSent` tiene un `type` que clasifica el request: `Document`, `Stylesheet`, `Script`, `XHR`, `Fetch`, `Image`, `Media`, `Font`, `WebSocket`, `Manifest`, `Ping`, `CSPViolationReport`, `Preflight`, `Other`.

### 2. Mock una API response

```javascript
await send('Fetch.enable', {
  patterns: [{ urlPattern: '*/api/users*' }]
});

// En cada Fetch.requestPaused event:
await send('Fetch.fulfillRequest', {
  requestId,
  responseCode: 200,
  body: btoa(JSON.stringify({ fake: 'data' }))
});
```

Ideal para tests sin tocar el backend real, o para reproducir bugs con responses controlados.

### 3. Bloquear ads / tracking / dominios pesados

```javascript
await send('Network.setBlockedURLs', {
  urls: [
    '*googletagmanager*',
    '*google-analytics*',
    '*doubleclick.net*',
    '*facebook.net*',
    '*hotjar*',
    '*segment.io*'
  ]
});
```

Acelera tests + reduce ruido en network logs.

### 4. Espiar autenticacion (ver que headers manda)

```javascript
ws.addEventListener('message', e => {
  const m = JSON.parse(e.data);
  if (m.method === 'Network.requestWillBeSent') {
    const auth = m.params.request.headers.Authorization;
    const cookie = m.params.request.headers.Cookie;
    if (auth || cookie) {
      console.log(m.params.request.url, { auth, cookie });
    }
  }
});
```

Captura `Authorization`, `Cookie` y otros headers sensibles en cada request — util para reverse-engineer APIs sin documentacion.

### 5. Modificar headers de salida (inyectar auth)

```javascript
await send('Network.setExtraHTTPHeaders', {
  headers: {
    'Authorization': 'Bearer ' + token,
    'X-Custom-Header': 'value'
  }
});
```

Se aplica a todos los requests subsecuentes en esa session CDP.

### 6. Simular conexion lenta (perf testing)

```javascript
await send('Network.emulateNetworkConditions', {
  offline: false,
  latency: 500,        // ms RTT
  downloadThroughput: 50 * 1024,  // 50 KB/s (3G lento)
  uploadThroughput: 20 * 1024
});
```

Detecta bugs que solo aparecen en redes flojas (race conditions, timeouts mal configurados).

### 7. Espiar trafico WebSocket

```javascript
ws.addEventListener('message', e => {
  const m = JSON.parse(e.data);
  if (m.method === 'Network.webSocketFrameSent') {
    console.log('WS OUT:', m.params.response.payloadData);
  }
  if (m.method === 'Network.webSocketFrameReceived') {
    console.log('WS IN:', m.params.response.payloadData);
  }
});
```

Util para reverse-engineer apps real-time (chat, trading, dashboards).

### 8. Leer response body de un request especifico

```javascript
// Cuando llega Network.loadingFinished con el requestId que te interesa:
const body = await send('Network.getResponseBody', { requestId });
console.log(body.result.body);  // string (base64 si binario)
```

Para scrape JSON/HTML sin volver a hacer el request manualmente.

---

## Como usarlo desde Claude Code (via MCP)

Una vez ejecutado `npx browser-ipc-cdp` y reconectado el MCP con `/mcp`, las herramientas disponibles son:

| Tool | Descripcion |
|------|-------------|
| `mcp__brave__list_network_requests` | Tabla de requests recientes con status, method, URL, tipo |
| `mcp__brave__get_network_request` | Body + headers de un request especifico por URL/ID |
| `mcp__brave__list_console_messages` | Console logs/errors/warnings |
| `mcp__brave__evaluate_script` | Ejecutar JS en una tab (incluye fetch, XHR custom) |
| `mcp__brave__lighthouse_audit` | Auditoria performance + SEO + accessibility |

Ejemplo de prompt en Claude Code:

> "Lista todas las requests fetch que hizo la pagina actual a `/api/`. Mostrame las que respondieron 4xx o 5xx con su body."

Claude usa `mcp__brave__list_network_requests` + `mcp__brave__get_network_request` para responder.

---

## Casos de uso reales

- **Debug API quebrada**: ver request real que manda tu app vs lo que esperas en backend
- **Reverse-engineer endpoints**: capturar trafico de un site sin documentacion publica
- **Auditar tracking**: que dominios de analytics/ads carga un site
- **Capturar respuestas para tests**: snapshot real de API → mock en unit tests
- **Bypass rate limit**: rotar User-Agent / IPs (con proxy) entre requests
- **Espiar 2FA flows**: ver que header/cookie escribe el server post-2FA
- **Validar performance**: waterfall de requests, identificar cuellos de botella
- **Test offline mode**: emular network down y ver como responde tu PWA
- **Mock APIs en desarrollo**: backend caido, frontend igual funciona con mocks

---

## CDP raw (sin MCP)

Si preferis controlar directo via WebSocket sin pasar por chrome-devtools-mcp:

```javascript
// Node 22+ tiene WebSocket nativo
const info = JSON.parse(fs.readFileSync('cdp_info.json', 'utf-8'));
const ws = new WebSocket(info.DEBUG_WS);

let id = 0;
const send = (method, params = {}) => new Promise(res => {
  const msgId = ++id;
  const handler = e => {
    const m = JSON.parse(e.data);
    if (m.id === msgId) { ws.removeEventListener('message', handler); res(m); }
  };
  ws.addEventListener('message', handler);
  ws.send(JSON.stringify({ id: msgId, method, params }));
});

ws.onopen = async () => {
  // Atachar a una tab especifica
  const tabs = await fetch(info.CDP_URL + '/json/list').then(r => r.json());
  const tabWs = new WebSocket(tabs[0].webSocketDebuggerUrl);
  // ... usar tabWs para Network commands
};
```

Schema completo de domains y metodos en `http://127.0.0.1:<PORT>/json/protocol`.

---

## Referencias

- CDP Network domain spec: https://chromedevtools.github.io/devtools-protocol/tot/Network/
- CDP Fetch domain spec: https://chromedevtools.github.io/devtools-protocol/tot/Fetch/
- chrome-devtools-mcp: https://github.com/google/chrome-devtools-mcp
