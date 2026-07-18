/**
 * Overlay del cursor — la "vista" que se dibuja DENTRO de la página.
 *
 * Feedback visual de lo que hace el MCP: una flecha que sigue el mouse, una
 * onda azul en cada click y una etiqueta con el elemento tocado (tag#id.class).
 * Los clicks de chrome-devtools-mcp llegan como eventos DOM reales
 * (Input.dispatchMouseEvent), así que estos listeners los capturan.
 *
 * La onda y la etiqueta son EFÍMERAS (se borran a ~1.4s): sirven a un humano
 * que mira en vivo. Pero el consumidor real durante la automatización es la
 * IA, que percibe la página por snapshot de accesibilidad y por screenshots
 * que toma DESPUÉS del click (>1.4s) — para entonces el rastro efímero ya no
 * está. Por eso además se deja un rastro PERSISTENTE del último click:
 *   - un pin fijo en la posición del click (visible en cualquier screenshot),
 *   - una etiqueta persistente con el elemento tocado, y
 *   - `document.documentElement[data-cl-lastclick]` con el descriptor, que
 *     aparece en el árbol de accesibilidad (take_snapshot) sin depender de
 *     screenshots. Ambos se sobrescriben en cada click (no se acumulan).
 *
 * Se exporta como STRING para inyectarlo por CDP con
 * Page.addScriptToEvaluateOnNewDocument (corre en cada documento nuevo, así
 * sobrevive a navegación y recarga — la limitación del intento manual previo).
 *
 * `OVERLAY_SOURCE` es una IIFE idempotente (window.__claudeCursor guard).
 */
const OVERLAY_SOURCE = `(() => {
  if (window.__claudeCursor) return;
  window.__claudeCursor = true;
  const ID = '__cl_cursor', Z = 2147483647;
  function boot() {
    if (!document.body || document.getElementById(ID)) return;
    const style = document.createElement('style');
    style.textContent =
      '@keyframes __clP{0%{transform:scale(.4);opacity:1}100%{transform:scale(2.6);opacity:0}}' +
      '.__cl_ripple{position:fixed;width:46px;height:46px;margin:-23px 0 0 -23px;border-radius:50%;' +
      'background:rgba(30,144,255,.35);border:3px solid #1e90ff;pointer-events:none;z-index:' + Z + ';' +
      'animation:__clP .9s ease-out forwards}' +
      '#' + ID + '{position:fixed;width:20px;height:20px;pointer-events:none;z-index:' + Z + ';' +
      'transition:left .1s linear,top .1s linear;filter:drop-shadow(0 1px 2px rgba(0,0,0,.5));' +
      'left:-40px;top:-40px}' +
      '.__cl_label{position:fixed;transform:translate(16px,-4px);background:#1e90ff;color:#fff;' +
      'font:11px/1.2 -apple-system,BlinkMacSystemFont,monospace;padding:3px 7px;border-radius:4px;' +
      'pointer-events:none;z-index:' + Z + ';white-space:nowrap;box-shadow:0 2px 6px rgba(0,0,0,.3)}' +
      // Rastro PERSISTENTE del último click: pin fijo + etiqueta que se quedan.
      '#__cl_pin{position:fixed;width:14px;height:14px;margin:-7px 0 0 -7px;border-radius:50%;' +
      'background:rgba(255,69,0,.25);border:2px solid #ff4500;pointer-events:none;z-index:' + Z + ';' +
      'display:none}' +
      '#__cl_last{position:fixed;transform:translate(12px,8px);background:#ff4500;color:#fff;' +
      'font:11px/1.2 -apple-system,BlinkMacSystemFont,monospace;padding:3px 7px;border-radius:4px;' +
      'pointer-events:none;z-index:' + Z + ';white-space:nowrap;box-shadow:0 2px 6px rgba(0,0,0,.3);display:none}';
    document.head.appendChild(style);
    const cur = document.createElement('div');
    cur.id = ID;
    cur.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20"><path d="M4 2l16 7-6.5 2.2L11 18z" fill="#1e90ff" stroke="#fff" stroke-width="1.3"/></svg>';
    document.body.appendChild(cur);
    const pin = document.createElement('div'); pin.id = '__cl_pin'; document.body.appendChild(pin);
    const last = document.createElement('div'); last.id = '__cl_last';
    last.setAttribute('role', 'status');
    document.body.appendChild(last);
    addEventListener('mousemove', (e) => { cur.style.left = e.clientX + 'px'; cur.style.top = e.clientY + 'px'; }, true);
    addEventListener('mousedown', (e) => {
      cur.style.left = e.clientX + 'px'; cur.style.top = e.clientY + 'px';
      const r = document.createElement('div'); r.className = '__cl_ripple';
      r.style.left = e.clientX + 'px'; r.style.top = e.clientY + 'px'; document.body.appendChild(r);
      const t = e.target, tag = (t && t.tagName ? t.tagName.toLowerCase() : '?'),
        id = (t && t.id ? '#' + t.id : ''),
        cls = (t && typeof t.className === 'string' && t.className ? '.' + t.className.trim().split(/\\s+/)[0] : '');
      const desc = tag + id + cls;
      const l = document.createElement('div'); l.className = '__cl_label';
      l.style.left = e.clientX + 'px'; l.style.top = e.clientY + 'px'; l.textContent = desc;
      document.body.appendChild(l);
      setTimeout(() => { r.remove(); l.remove(); }, 1400);
      // Rastro persistente: sobrevive hasta el próximo click, así el screenshot
      // o el snapshot que la IA toma DESPUÉS sí lo ven.
      pin.style.left = e.clientX + 'px'; pin.style.top = e.clientY + 'px'; pin.style.display = 'block';
      last.style.left = e.clientX + 'px'; last.style.top = e.clientY + 'px';
      last.textContent = 'click: ' + desc + ' @' + Math.round(e.clientX) + ',' + Math.round(e.clientY);
      last.style.display = 'block';
      // Legible por take_snapshot (árbol de accesibilidad), sin depender de píxeles.
      try { document.documentElement.setAttribute('data-cl-lastclick', desc + ' @' + Math.round(e.clientX) + ',' + Math.round(e.clientY)); } catch (_) {}
    }, true);
  }
  if (document.body) boot();
  else addEventListener('DOMContentLoaded', boot);
})();`;

module.exports = { OVERLAY_SOURCE };
