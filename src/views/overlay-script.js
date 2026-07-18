/**
 * Overlay del cursor — la "vista" que se dibuja DENTRO de la página.
 *
 * Feedback visual de lo que hace el MCP: una flecha que sigue el mouse, una
 * onda azul en cada click y una etiqueta con el elemento tocado (tag#id.class).
 * Los clicks de chrome-devtools-mcp llegan como eventos DOM reales
 * (Input.dispatchMouseEvent), así que estos listeners los capturan.
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
      'pointer-events:none;z-index:' + Z + ';white-space:nowrap;box-shadow:0 2px 6px rgba(0,0,0,.3)}';
    document.head.appendChild(style);
    const cur = document.createElement('div');
    cur.id = ID;
    cur.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20"><path d="M4 2l16 7-6.5 2.2L11 18z" fill="#1e90ff" stroke="#fff" stroke-width="1.3"/></svg>';
    document.body.appendChild(cur);
    addEventListener('mousemove', (e) => { cur.style.left = e.clientX + 'px'; cur.style.top = e.clientY + 'px'; }, true);
    addEventListener('mousedown', (e) => {
      cur.style.left = e.clientX + 'px'; cur.style.top = e.clientY + 'px';
      const r = document.createElement('div'); r.className = '__cl_ripple';
      r.style.left = e.clientX + 'px'; r.style.top = e.clientY + 'px'; document.body.appendChild(r);
      const t = e.target, tag = (t && t.tagName ? t.tagName.toLowerCase() : '?'),
        id = (t && t.id ? '#' + t.id : ''),
        cls = (t && typeof t.className === 'string' && t.className ? '.' + t.className.trim().split(/\\s+/)[0] : '');
      const l = document.createElement('div'); l.className = '__cl_label';
      l.style.left = e.clientX + 'px'; l.style.top = e.clientY + 'px'; l.textContent = tag + id + cls;
      document.body.appendChild(l);
      setTimeout(() => { r.remove(); l.remove(); }, 1400);
    }, true);
  }
  if (document.body) boot();
  else addEventListener('DOMContentLoaded', boot);
})();`;

module.exports = { OVERLAY_SOURCE };
