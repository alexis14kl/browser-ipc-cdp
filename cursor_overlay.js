// cursor_overlay.js
//
// Overlay visual para ver los clicks que hace el MCP brave (chrome-devtools-mcp)
// en la pagina. Sin esto, los clicks de CDP son invisibles y no puedes seguir
// que esta haciendo el agente en tu navegador.
//
// USO desde Claude Code (o cualquier cliente del MCP brave):
//
//   mcp__brave__evaluate_script({
//     function: <pegar el contenido de installCursorOverlay como string>
//   })
//
// USO directo en DevTools console:
//
//   1. Abre la pagina en tu navegador
//   2. F12 -> Console
//   3. Pega TODO este archivo y enter
//   4. Llama: installCursorOverlay()
//
// QUE HACE:
//   - Pulso rojo (3s) en cada click
//   - Etiqueta con tag#id.class del elemento clickeado
//   - Punto rojo fijo marcando la ultima posicion clickeada
//
// LIMITACION:
//   El overlay vive en el JS de la pagina. Si recargas o navegas a otra URL,
//   se pierde y hay que reinyectarlo.

function installCursorOverlay() {
  if (window.__claudeCursorInstalled) return { ok: true, msg: 'ya estaba instalado' };
  window.__claudeCursorInstalled = true;

  const style = document.createElement('style');
  style.id = '__claude_cursor_style';
  style.textContent = `
    @keyframes claudePulse { 0%{transform:scale(0.4);opacity:1} 100%{transform:scale(2.5);opacity:0} }
    .__claude_dot { position:fixed; width:50px; height:50px; margin-left:-25px; margin-top:-25px;
      border-radius:50%; background:rgba(255,30,30,0.5); border:3px solid #ff0000;
      pointer-events:none; z-index:2147483647; animation:claudePulse 3s ease-out forwards; }
    .__claude_label { position:fixed; transform:translate(20px,-12px); background:#ff0000; color:#fff;
      font:12px/1.2 monospace; padding:4px 8px; border-radius:4px; pointer-events:none;
      z-index:2147483647; box-shadow:0 2px 6px rgba(0,0,0,0.3); }
    #__claude_cursor { position:fixed; width:14px; height:14px; margin-left:-7px; margin-top:-7px;
      border-radius:50%; background:#ff0000; border:2px solid #fff; pointer-events:none;
      z-index:2147483647; box-shadow:0 0 8px rgba(255,0,0,0.8); display:none; }
  `;
  document.head.appendChild(style);

  const cursor = document.createElement('div');
  cursor.id = '__claude_cursor';
  document.body.appendChild(cursor);

  window.addEventListener('mousedown', (e) => {
    const t = e.target;
    const tag = t && t.tagName ? t.tagName.toLowerCase() : '?';
    const id  = t && t.id ? '#' + t.id : '';
    const cls = t && t.className && typeof t.className === 'string'
      ? '.' + t.className.split(' ')[0] : '';

    const dot = document.createElement('div');
    dot.className = '__claude_dot';
    dot.style.left = e.clientX + 'px';
    dot.style.top  = e.clientY + 'px';
    document.body.appendChild(dot);

    const lbl = document.createElement('div');
    lbl.className = '__claude_label';
    lbl.style.left = e.clientX + 'px';
    lbl.style.top  = e.clientY + 'px';
    lbl.textContent = tag + id + cls;
    document.body.appendChild(lbl);

    cursor.style.left = e.clientX + 'px';
    cursor.style.top  = e.clientY + 'px';
    cursor.style.display = 'block';

    setTimeout(() => { dot.remove(); lbl.remove(); }, 3000);
  }, true);

  return { ok: true, msg: 'cursor instalado' };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { installCursorOverlay };
}
