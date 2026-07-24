# Arquitectura v3.0.0 — MVC + CdpService por plataforma

> Documento de diseño del refactor. Regla de oro: **ninguna fase puede dejar el
> proyecto no-funcional**. Cada función existente tiene un destino explícito en
> la tabla de mapeo; nada se reescribe "de memoria", todo se **mueve** con su test.

## 1. Problema actual

Tres implementaciones paralelas de lo mismo (2.607 líneas):

| Mundo | Entrada | Duplica |
|---|---|---|
| CLI (`bin/cli.js` + `lib/*`) | `npx browser-ipc-cdp` | detección de navegador, testCdp, DevToolsActivePort, launch |
| MCP (`brave_mcp_launcher.js`) | Claude Code (stdio) | TODO lo anterior otra vez (no puede importar `lib/` porque `lib/logger.js` escribe a stdout y rompería el JSON-RPC del MCP) |
| Python (`brave_ipc.py`) | auto-launch / manual | TODO otra vez, en Python |

Consecuencia: un fix en una copia no llega a las otras (regresión v2.3.0 = ejemplo real).

## 2. Diseño: MVC con CdpService como helper por plataforma

```
src/
├── platform/                  ← Strategy: 1 archivo = 1 plataforma
│   ├── index.js               ← Factory: detecta win32/darwin/linux/wsl UNA vez
│   │                             y devuelve el PlatformHelper correcto
│   ├── base.js                ← interfaz/contrato PlatformHelper (documentada)
│   ├── win.js                 ← netstat/tasklist, LOCALAPPDATA, netsh, taskkill
│   ├── darwin.js              ← ps+lsof, ~/Library/Application Support, osascript quit
│   ├── linux.js               ← ps+lsof, XDG_CONFIG_HOME
│   └── wsl.js                 ← extiende win: cmd.exe, IP del host, portproxy
│
├── services/
│   ├── cdp-service.js         ← ★ EL HELPER CENTRAL (única API de CDP)
│   │     testCdp(url)                    ← hoy duplicada en launcher y browser.js
│   │     readActivePort(profileDir)
│   │     discoverProfiles()
│   │     resolve({ launch })             ← Chain of Responsibility:
│   │                                        ActivePort → Processes → AutoLaunch
│   │     launch(browser, opts)
│   │   (recibe el PlatformHelper por inyección; NO conoce process.platform)
│   ├── cdp-proxy.js           ← ya bien diseñado; solo se le inyecta el logger
│   ├── auto-launch.js         ← Adapter sobre brave_ipc.py (cooldown 30s, pickPython)
│   └── runner-factory.js      ← Factory del spawn de chrome-devtools-mcp (bin/npx)
│
├── models/                    ← estado puro, sin I/O (trivial de testear)
│   ├── browser-registry.js    ← definiciones de navegadores + rutas por plataforma
│   └── cdp-endpoint.js        ← { port, version, mode, proxyPort }
│
├── views/                     ← TODA salida pasa por aquí
│   ├── logger.js              ← stream INYECTABLE: CLI→stdout, MCP→stderr (mata
│   │                             estructuralmente el bug que causó la duplicación)
│   ├── console-view.js        ← banner, pasos [1/6], resumen del CLI
│   └── cdp-info-view.js       ← cdp_info.json (vista persistida del estado)
│
├── controllers/
│   ├── cli-controller.js      ← flujo del instalador (hoy cli.js main())
│   └── mcp-controller.js      ← flujo del launcher (resolve rápido sin launch →
│                                 proxy → warm-up background → spawn MCP)
│
index.js                       ← Facade: API pública estable y versionada
cli.js                         ← delgado: parsea flags → CliController (en la
                                  raíz, NO en bin/: un bin/ top-level en la raíz
                                  del plugin lo rechaza el hosting de claude.ai)
brave_mcp_launcher.js          ← delgado: → McpController (RUTA INTACTA: los
                                  ~/.claude.json de los usuarios apuntan aquí)
test-claude/                          ← node:test, sin dependencias nuevas
```

### Por qué CdpService + PlatformHelper

- **Tocar Windows no puede romper Mac**: cada plataforma vive en su archivo con
  la misma interfaz. Soportar una nueva plataforma = agregar un archivo.
- **Una sola implementación de cada cosa**: `testCdp`, `DevToolsActivePort`,
  discovery, launch — el CLI y el MCP consumen el MISMO servicio.
- **El servicio no sabe en qué OS corre**: recibe el helper por inyección →
  en los tests se le pasa un helper falso y se prueba la lógica sin OS real.

## 3. Mapeo función por función (contrato de no-pérdida)

| Hoy | Destino |
|---|---|
| launcher: `IS_WIN/IS_WSL/HOME/LOCALAPPDATA` | `platform/index.js` (Factory) |
| launcher: `USER_DATA_DIRS` (win/darwin/linux + env extra) | `models/browser-registry.js` + cada `platform/*.userDataDirs()` |
| launcher: `testCdp()` ⚠ dup con browser.js:232 | `services/cdp-service.js` (única) |
| launcher: `readDevToolsActivePort()` | `cdp-service.readActivePort()` |
| launcher: `discoverProfilesDynamically()` | `cdp-service.discoverProfiles()` |
| launcher: `tryDevToolsActivePort()` | estrategia `ActivePortStrategy` dentro de `cdp-service.resolve()` |
| launcher: `firstLiveCdp()` | helper interno de cdp-service |
| launcher: `discoverViaPosix()` (ps+lsof) | `platform/darwin.js` + `platform/linux.js` `.processDiscovery()` |
| launcher: `discoverViaNetstat()` (tasklist+netstat) | `platform/win.js.processDiscovery()` |
| launcher: `pickPython()` + `autoLaunch()` + cooldown | `services/auto-launch.js` (Adapter de brave_ipc.py) |
| launcher: `ensureCdp({launch})` | `cdp-service.resolve({launch})` |
| launcher: `resolveChromeDevtoolsMcpBin()` + `pickRunner()` | `services/runner-factory.js` |
| launcher: `writeCdpInfo()` | `views/cdp-info-view.js` |
| launcher: `startDynamicProxy()` + `main()` | `controllers/mcp-controller.js` |
| launcher: `log()` (stderr) | `views/logger.js` con stream=stderr |
| src/services/cdp-proxy.js completo (probeProxy, reclaimPort, startProxy…) | `services/cdp-proxy.js` (movido, logger inyectado) |
| lib/browser.js: `detectBrowsers/findBrowser/getBrowserPaths` | `models/browser-registry.js` + platform helpers |
| lib/browser.js: `detectExistingCDP` | `cdp-service.resolve()` (misma cascada) |
| lib/browser.js: `launchBrowser/killBrowser/isBrowserRunning` | `cdp-service.launch()` + `platform/*.js` |
| lib/browser.js: `isWSL/getWindowsEnv` | `platform/wsl.js` |
| lib/network.js: `setupFirewall/setupPortproxy` (netsh) | `platform/win.js` / `platform/wsl.js` (no-op en mac/linux) |
| lib/mcp.js: `getWslHostIp/updateMcpJson/updateClaudeUserConfig` | `platform/wsl.js` + `views/` (escritura de .mcp.json) |
| lib/config.js: `saveCdpInfo/loadCdpInfo` | `views/cdp-info-view.js` (unificado con writeCdpInfo del launcher) |
| lib/logger.js (⚠ stdout, bug `table` no existe) | `views/logger.js` — se corrige el import fantasma en cli.js:19 |
| brave_ipc.py | SE QUEDA tal cual en v3.0.0 (lo envuelve auto-launch.js). Portarlo a JS = fase futura opcional |

## 4. Protocolo anti-rotura

1. **Fase 0 — red de seguridad ANTES de mover nada**: tests sobre el código
   ACTUAL que capturan el comportamiento que no puede cambiar:
   - handshake MCP: `initialize` responde < 5s (regresión v2.3.0)
   - proxy: puerto fijo 9333, `x-cdp-proxy` header, reclaim de huérfano (v2.3.1)
   - `rewriteBody`, `readDevToolsActivePort`, parsers de `ps`/`netstat` (unit, con fixtures)
   - `--resolve-only` / `--proxy-only`
   Estos tests quedan verdes durante TODO el refactor.
2. **Mover, no reescribir**: cada función se traslada con su comportamiento
   intacto; los cambios de comportamiento van en commits separados y explícitos.
3. **Compatibilidad congelada**: rutas de ambos bins, flags (`--resolve-only`,
   `--proxy-only`, `--browser`, `--list`, `--status`…), env vars
   (`BROWSER_CDP_PROXY_PORT`, `BROWSER_CDP_NO_PROXY`, `BROWSER_CDP_EXTRA_PROFILES`),
   formato de `cdp_info.json`. Nada de esto cambia en v3.0.0.
4. **Verificación por fase**: `node --check` + suite de tests + handshake real
   (`printf initialize | node brave_mcp_launcher.js`) + `npm pack --dry-run`.
5. **CI**: GitHub Actions con matrix ubuntu/macos/windows en cada push.

## 5. Fases (cada una termina 100% funcional)

| Fase | Contenido | Riesgo |
|---|---|---|
| 0 | Tests de humo + unit sobre código actual | nulo (solo agrega) |
| 1 | `platform/` + `views/logger.js` inyectable | bajo |
| 2 | `services/cdp-service.js`: deduplicar testCdp/ActivePort/discovery; launcher y CLI lo consumen | medio (cubierto por Fase 0) |
| 3 | `models/` + `views/` + `controllers/`; bins quedan delgados | bajo |
| 4 | CI + `npm publish` v3.0.0 | nulo |
| 5 (opcional) | Portar brave_ipc.py a JS (`services/launch/`) | futuro |

## 6. Estado final (as-built, v3.0.1)

El refactor se completó, con algunas consolidaciones respecto al diseño de
arriba (que se conserva como registro del plan):

| Diseñado | Cómo quedó |
|---|---|
| `models/browser-registry.js` + `models/cdp-endpoint.js` | Consolidado en `services/browser-detect.js` (registry + detección + launch/kill); no hubo carpeta `models/` |
| `services/runner-factory.js` | Inline en `mcp-controller.js` (`pickRunner`) |
| `views/console-view.js` | Absorbido por `views/logger.js` + `views/cdp-info-view.js` |
| `index.js` (Facade) | No se creó: los dos bins (`cli.js`, `brave_mcp_launcher.js`) son la API pública |
| Fase 5 (portar `brave_ipc.py` a JS) | **COMPLETADA**: `auto-launch.js` ahora usa `findBrowser`/`launchBrowser` (JS puro). `brave_ipc.py` y `brave_cdp.bat` eliminados. Única dependencia del proyecto: Node ≥ 20.19 (sin Python) |

Agregado fuera del diseño original: `services/cursor-overlay.js` +
`views/overlay-script.js` — overlay visual del cursor inyectado vía CDP en
todas las páginas (v3.0.0 opt-in, v3.0.1 ON por defecto con opt-out
`BROWSER_CDP_CURSOR=0`).

## 7. Deduplicación del lado CLI (post v3.1.0)

`services/browser-detect.js` (el instalador heredado de `lib/browser.js`)
conservaba copias propias de lo que la sección 2 declaraba único. Se cerró
esa deuda: ahora **"el CLI y el MCP consumen el MISMO servicio"** también es
cierto del lado CLI.

| Copia eliminada | Fuente única |
|---|---|
| `testCdp` de browser-detect (y `fetchJson` de cli-controller) | `cdp-service` exporta `fetchJson`/`testCdp`/`readActivePort` como **estáticas** además del factory |
| Lecturas inline de `DevToolsActivePort` (detectExistingCDP, launchBrowser) | `cdp-service.readActivePort()` |
| `IS_WIN/IS_MAC/isWSL` de browser-detect, network y mcp-config; `process.platform` en cdp-proxy | `platform/index.getPlatformId()` — que absorbió el chequeo `WSLInterop` que solo tenía browser-detect |

`browser-detect` ya no exporta `testCdp`/`IS_*` (sin consumidores); su API
queda en `detectBrowsers/findBrowser/detectExistingCDP/launchBrowser`.
`test-claude/browser-detect.test.js` cubre las estáticas, el camino
DevToolsActivePort de `detectExistingCDP` contra un CDP falso, y dos reglas
de arquitectura ejecutables: `process.platform` solo se consulta en
`platform/index.js` y `testCdp` solo se define en `cdp-service.js`.

## 8. UpdateService — ruta fija + swap atómico (v3.2.0)

Problema: el instalador escribía en las configs la ruta absoluta de la copia
desde donde corrió (p. ej. `~/.npm/_npx/<hash>/…`). Al publicar una versión
nueva, la config seguía ejecutando la copia vieja: la IA trabajaba con código
desactualizado aunque el paquete se actualizara en npm. Además `--uninstall`
era un stub que no borraba nada.

Solución — `services/update.js`:

| Pieza | Qué hace |
|---|---|
| `ensureInstalled()` | Paso [6/7] del CLI: se auto-copia a `~/.browser-ipc-cdp/app` y devuelve la ruta del launcher que `updateMcpJson` escribe en las configs. Checkout git → modo dev, apunta al repo (npm link intacto). |
| `selfInstall()` | Swap por rename (`app.new` → `app`, la vieja a `app.old` y se borra): **lo viejo desaparece por completo**, incluidos archivos que la versión nueva ya no trae. Idempotente por versión; si falla a medias, revierte. Copia también las dependencias hermanas del caché de npx (`chrome-devtools-mcp`) para que `require.resolve` del launcher las encuentre. |
| `checkForUpdate()` | Compara la versión local contra el registry de npm usando el `fetchJson` de cdp-service (que ganó soporte https). Best-effort: sin red devuelve null, jamás rompe el flujo. El CLI avisa al final; el launcher MCP loguea su versión a stderr al arrancar y avisa si corre código viejo (fire-and-forget, no toca el handshake). |
| `uninstall()` + `mcp-config.removeBraveConfig()` | `--uninstall` real: borra `~/.browser-ipc-cdp` y quita `mcpServers.brave` de los `.mcp.json`/`.claude.json` conocidos (write atómico, preserva el resto). |

`test-claude/update.test.js` (9 tests): el swap borra lo viejo y deja lo
nuevo, idempotencia, copia de dependencias hermanas, modo dev, registry falso
para outdated true/false/null, uninstall y removeBraveEntry con rutas
explícitas — nunca contra las configs reales de la máquina.

## 9. cdp_info.json unificado (v3.2.3)

La ruta fija trajo una consecuencia: el estado NO puede vivir junto al
launcher, porque el swap de actualización borra `app/` entero. Además había
dos vistas divergentes: el MCP escribía junto al launcher y `--status` leía
cwd/home — en modo PROXY el status quedaba ciego.

Unificación en `views/cdp-info-view.js` (absorbe `cli-cdp-info.js`, como
pedía el diseño original):
- Ruta canónica `~/cdp_info.json` (la histórica del contrato v2.3.x); el CLI
  escribe además copia en cwd (compat legacy).
- `loadCdpInfo()` elige el archivo MÁS RECIENTE por mtime: `--status` siempre
  ve lo último, lo haya escrito el MCP (PROXY) o el CLI (ATTACHED/LAUNCHED).
- `browser_config.json` (JS y Python) migra a `~/.browser-ipc-cdp/` — la
  preferencia de navegador también sobrevive updates; `--uninstall` limpia
  ambos estados.
- Los tests que spawnean el launcher real aíslan HOME/USERPROFILE a un
  tmpdir: la suite jamás toca el estado real del usuario.

## 10. Distribución multi-canal — plugin de Claude Code + bundle `.mcpb` (v3.11.0–3.11.1)

Al núcleo (launcher + `cdp-service` + tools) se le sumaron dos canales de
distribución además de npm, **sin tocar el flujo existente**:

| Canal | Entrada | Config |
|---|---|---|
| **npm** (histórico) | `npx browser-ipc-cdp` → `/mcp` | `.mcp.json`/`.claude.json` → ruta fija `~/.browser-ipc-cdp/app` (§8) |
| **Plugin de Claude Code** | `/plugin marketplace add alexis14kl/browser-ipc-cdp` | `.claude-plugin/{marketplace,plugin}.json` + `mcp-config.json` (`${CLAUDE_PLUGIN_ROOT}/brave_mcp_launcher.js`) |
| **Claude Desktop** | arrastrar `browser-ipc-cdp.mcpb` | `manifest.json` (spec MCPB 0.3), empaquetado con `mcpb pack` |

> **Marketplace en la app de escritorio (RESUELTO en v3.11.3):** la **app de escritorio** (Ajustes
> → Plugins → Agregar marketplace) valida en el hosting de claude.ai con un criterio más
> estricto que rechaza un directorio **`bin/` de nivel superior** en la raíz del plugin (los
> ejecutables de `bin/` entran al `PATH` del CLI pero no aparecen en la superficie de aprobación
> de admin de Desktop). Como `source: "./"`, la raíz del repo es la raíz del plugin, así que el
> antiguo `bin/cli.js` caía dentro y la sincronización fallaba. **Fix:** el CLI se movió a `cli.js`
> en la raíz —el composition root vive en el borde, no en un `bin/`—, eliminando el `bin/` top-level
> **sin re-hogar** y manteniendo `source: "./"` (el vendor sigue en el subárbol → sin arranque
> en frío en Desktop; `update.js` solo cambió `PACKAGE_FILES: 'bin'→'cli.js'`). Clave descubierta:
> un `bin/` **anidado** (p. ej. `node_modules/chrome-devtools-mcp/build/src/bin/`) NO dispara el
> validador; solo el top-level. **Verificado end-to-end:** «Agregar marketplace» desde la app de
> escritorio (por `alexis14kl/browser-ipc-cdp` y por URL de git) sincroniza sin error.

Piezas nuevas, todas respetando el patrón factory + DI:

- **Modo bundle** (`BROWSER_IPC_CDP_BUNDLE=1`, seteado por el `manifest`/`mcp-config`):
  el paquete/plugin ES la unidad de versión, así que el launcher **salta** el aviso
  de auto-update (§8) e **inyecta las `instructions`** (no hay skill que las aporte).
  El flujo npx/ruta-fija no lo setea → queda idéntico a como estaba.
- **Vendor versionado**: `chrome-devtools-mcp` se commitea al repo (whitelist en
  `.gitignore`: `node_modules/*` + `!node_modules/chrome-devtools-mcp/`) para que el
  clon del plugin lo traiga → `require.resolve` lo encuentra y corre con el node de
  la sesión, **sin `npx` en frío**. `npm publish` sigue limpio (el `files` whitelist
  excluye `node_modules`).
- **Instrucciones MCP** (`views/mcp-instructions.js`): el `McpStdioProxy` las
  **anexa** a la respuesta `initialize` (mismo patrón con que ya inyectaba las tools
  custom en `tools/list`), dándole a Claude Desktop/plugin la guía operativa que en
  Claude Code (npm) aporta la skill `mcp-brave`.

## 11. ensurePage — el resolver garantiza ≥1 pestaña (v3.11.2)

Síntoma: chrome-devtools-mcp fallaba en bucle con **"No page selected"**. Causa:
`testCdp` solo validaba `/json/version` (navegador VIVO), nunca que tuviera
**targets de tipo `page`**. Así la cascada de `resolve()` aceptaba un navegador vivo
pero con **0 pestañas** —una instancia zombi, o en Mac al cerrar la ventana el
proceso sigue vivo— y el MCP no tenía página que manejar.

Fix en `cdp-service.js` (misma capa, funciones module-level puras junto a
`fetchJson`/`testCdp`/`readActivePort`):

| Función | Qué hace |
|---|---|
| `listPages(baseUrl)` | Targets `type === 'page'` de `/json/list` (o `[]` si falla). |
| `openNewTab(baseUrl, url)` | Crea una pestaña vía `/json/new` (PUT en Chromium ≥ M111, con fallback GET). |
| `ensurePage(baseUrl)` | Si hay ≥1 página no hace nada; si hay 0, crea `about:blank`. Best-effort, nunca lanza. |

`resolve()` llama `ensurePage` sobre el backend resuelto antes de devolverlo (en las
tres ramas: ActivePort → discovery → auto-launch), vía un helper `ensure` por
closure. Así el navegador **se auto-cura**: nunca se entrega un backend sin página.
Beneficia a **ambos canales** (npm y plugin comparten `cdp-service`).

`test-claude/ensure-page.test.js` (4 casos con un HTTP server local que simula
`/json/list` y `/json/new`): filtra `type=page`, no crea si ya hay, crea con PUT si
hay 0, cae a GET si PUT devuelve 405.
