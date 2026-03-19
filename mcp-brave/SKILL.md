---
name: mcp-brave
description: Conectar y controlar Brave Browser via IPC + CDP. Usar cuando el usuario pida "abrir brave", "conectar brave", "usar brave", "navegar con brave", "controlar brave", "brave cdp", "brave ipc", o quiera interactuar con su navegador real desde Claude Code.
version: 1.0.0
---

# MCP Brave - Control de Brave via IPC + CDP

## Modo de Operacion

**AUTONOMO.** Ejecutar paso a paso sin preguntar.

---

## PASO 1: Verificar si Brave CDP ya esta activo

Leer el archivo `cdp_info.json` para obtener el puerto actual:

```bash
cat /mnt/c/Users/NyGsoft/Desktop/ipc/cdp_info.json
```

Si existe y tiene un puerto, verificar si CDP responde:

```bash
curl -s --connect-timeout 3 http://WINDOWS_HOST_IP:PUERTO/json/version
```

Para obtener la IP de Windows desde WSL:
```bash
grep nameserver /etc/resolv.conf
```

| Resultado | Accion |
|-----------|--------|
| CDP responde | Ir al PASO 3 (ya esta listo) |
| CDP no responde | Ir al PASO 2 (lanzar Brave) |
| cdp_info.json no existe | Ir al PASO 2 |

---

## PASO 2: Lanzar Brave con CDP

Indicar a Alexis que ejecute en Windows:

```bat
C:\Users\NyGsoft\Desktop\ipc\brave_cdp.bat
```

O desde terminal:
```bat
python C:\Users\NyGsoft\Desktop\ipc\brave_ipc.py
```

El script automaticamente:
1. Cierra Brave existente
2. Abre Brave con `--remote-debugging-port=0` (puerto dinamico IPC)
3. Detecta el puerto via `DevToolsActivePort`
4. Configura `netsh portproxy` para WSL
5. Actualiza `.mcp.json` con el nuevo puerto
6. Guarda todo en `cdp_info.json`

**Modos disponibles:**

| Comando | Perfil |
|---------|--------|
| `python brave_ipc.py` | **REAL** - Tu Brave con bookmarks, passwords, extensiones, sesiones |
| `python brave_ipc.py --clean` | Limpio - Sesion vacia para testing |

Despues de ejecutar, pedir a Alexis que haga `/mcp` en Claude Code para reconectar.

---

## PASO 3: Usar MCP Brave

Una vez conectado, las herramientas disponibles son:

### Navegacion
- `mcp__brave__list_pages` — Ver todas las tabs abiertas
- `mcp__brave__select_page` — Seleccionar una tab por ID
- `mcp__brave__navigate_page` — Navegar a URL
- `mcp__brave__new_page` — Abrir nueva tab
- `mcp__brave__close_page` — Cerrar tab

### Interaccion
- `mcp__brave__take_snapshot` — Leer contenido de la pagina (a11y tree)
- `mcp__brave__take_screenshot` — Captura de pantalla
- `mcp__brave__click` — Click en elemento por uid
- `mcp__brave__fill` — Escribir en campo de texto
- `mcp__brave__press_key` — Presionar tecla (Enter, Tab, etc.)
- `mcp__brave__hover` — Hover sobre elemento
- `mcp__brave__type_text` — Escribir texto caracter por caracter

### Avanzado
- `mcp__brave__evaluate_script` — Ejecutar JavaScript en la pagina
- `mcp__brave__list_network_requests` — Ver requests de red
- `mcp__brave__get_network_request` — Detalle de un request especifico
- `mcp__brave__list_console_messages` — Ver consola del navegador
- `mcp__brave__fill_form` — Llenar formulario completo
- `mcp__brave__lighthouse_audit` — Auditoria de performance/SEO

---

## Datos Tecnicos

| Campo | Valor |
|-------|-------|
| Brave exe | `C:\Program Files\BraveSoftware\Brave-Browser\Application\brave.exe` |
| Perfil real | `%LOCALAPPDATA%\BraveSoftware\Brave-Browser\User Data` |
| Perfil limpio | `%USERPROFILE%\brave-cdp-profile` |
| Puerto CDP | Dinamico (asignado por IPC, guardado en cdp_info.json) |
| Portproxy | `0.0.0.0:PUERTO → 127.0.0.1:PUERTO` (auto-configurado) |
| IP WSL→Windows | Variable (leer de `/etc/resolv.conf`) |
| Scripts | `C:\Users\NyGsoft\Desktop\ipc\` |
| MCP config | `C:\Users\NyGsoft\.mcp.json` (auto-actualizado) |

---

## Ventajas del modo IPC

- **Tu Brave real**: bookmarks, passwords, extensiones, sesiones activas (Jira, WhatsApp, n8n, etc.)
- **Puerto dinamico**: sin conflictos, el OS asigna puerto libre
- **Sin IFEO/registry**: no modifica el sistema
- **Portproxy automatico**: WSL alcanza el puerto sin config manual
- **.mcp.json auto-actualizado**: Claude Code reconecta con `/mcp`

---

## Troubleshooting

| Problema | Solucion |
|----------|----------|
| MCP "brave" no conecta | Verificar puerto en `.mcp.json` vs `cdp_info.json`. Ejecutar `/mcp` |
| CDP no responde desde WSL | Verificar portproxy: `netsh interface portproxy show all` |
| IP de WSL cambio | `grep nameserver /etc/resolv.conf` → actualizar `.mcp.json` |
| Brave no abre | Verificar ruta del exe. Ejecutar `brave_ipc.py` manualmente |
| UAC cada vez | Normal. El portproxy necesita Admin. Solo pide una vez por sesion |
| Puerto cambio | Es dinamico. Ejecutar `brave_ipc.py` actualiza todo automaticamente |
