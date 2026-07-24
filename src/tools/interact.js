/**
 * Tools de interacción por TEXTO y navegación TOLERANTE.
 *
 * Objetivo: minimizar tokens y round-trips de la IA. En apps grandes un
 * `take_snapshot` completo (árbol de accesibilidad) cuesta miles de tokens;
 * aquí se localiza/actúa por texto con UNA llamada y salida mínima, y se
 * evita el falso negativo del timeout de carga.
 *
 * Todo via `_cdp-caller` one-shot (request/response): `Runtime.evaluate` para
 * buscar en la página, `Input.dispatchMouseEvent` para el click (pasa por el
 * proxy :9333 → dibuja el overlay del cursor) y `Page.navigate` + polling de
 * `document.readyState` para navegar sin depender de eventos (que el caller
 * one-shot no escucha).
 */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Helpers in-page compartidos, inyectados como texto en Runtime.evaluate.
//  __norm    colapsa espacios y recorta.
//  __matches exact o contains (case-insensitive).
//  __visible descarta elementos sin caja o display/visibility ocultos.
//  __collect devuelve los elementos VISIBLES cuyo texto propio (hoja más
//            específica) matchea; limit=0 = sin tope.
const INPAGE_HELPERS = `
  function __norm(s){ return (s||'').replace(/\\s+/g,' ').trim(); }
  function __matches(t,q,exact){ t=__norm(t); return exact ? t===q : t.toLowerCase().indexOf(q.toLowerCase())>=0; }
  function __visible(el){ var r=el.getBoundingClientRect(); if(r.width<=0||r.height<=0) return null; var s=getComputedStyle(el); if(s.visibility==='hidden'||s.display==='none'||s.opacity==='0') return null; return r; }
  function __collect(q,exact,tag,limit){
    var all=document.querySelectorAll(tag||'*'), out=[];
    for(var i=0;i<all.length;i++){
      var el=all[i], own=__norm(el.textContent);
      if(!own||!__matches(own,q,exact)) continue;
      var childMatch=false;
      for(var c=0;c<el.children.length;c++){ if(__matches(el.children[c].textContent,q,exact)){ childMatch=true; break; } }
      if(childMatch) continue;                 // preferir la hoja más específica
      var r=__visible(el); if(!r) continue;
      out.push({el:el, rect:r, text:own});
      if(limit&&out.length>=limit) break;
    }
    return out;
  }
`;

const selArg = (v) => (v ? JSON.stringify(String(v).toLowerCase()) : 'null');

function createInteractTools({ caller }) {
  const findByText = {
    name: 'find_by_text',
    description: 'Localiza elementos por su texto VISIBLE sin un snapshot completo. Barato en tokens: devuelve solo las coincidencias (texto, tag, coordenadas de click). Prefiérelo a take_snapshot para ubicar un elemento concreto.',
    inputSchema: {
      type: 'object',
      required: ['text'],
      properties: {
        text:  { type: 'string',  description: 'Texto a buscar (contains por defecto).' },
        exact: { type: 'boolean', description: 'Coincidencia exacta en vez de contains. Default false.' },
        tag:   { type: 'string',  description: 'Filtrar por tag (p.ej. "button", "a", "input"). Opcional.' },
        limit: { type: 'number',  description: 'Máx. de coincidencias a devolver. Default 5 (tope 25).' },
      },
    },
    async handler(args) {
      const limit = args.limit && args.limit > 0 ? Math.min(Math.floor(args.limit), 25) : 5;
      const expr = `(function(){ ${INPAGE_HELPERS}
        var found=__collect(${JSON.stringify(String(args.text))}, ${!!args.exact}, ${selArg(args.tag)}, ${limit});
        return JSON.stringify(found.map(function(m){ return {
          text: m.text.length>80 ? m.text.slice(0,80)+'…' : m.text,
          tag: m.el.tagName.toLowerCase(),
          x: Math.round(m.rect.left+m.rect.width/2),
          y: Math.round(m.rect.top+m.rect.height/2),
          id: m.el.id||undefined,
          name: m.el.getAttribute('name')||undefined
        }; }));
      })()`;
      const res = await caller.call('Runtime.evaluate', { expression: expr, returnByValue: true });
      if (res.exceptionDetails) return [{ type: 'text', text: `find_by_text error: ${res.exceptionDetails.text || 'exception'}` }];
      const matches = JSON.parse(res.result?.value || '[]');
      if (!matches.length) return [{ type: 'text', text: `Sin coincidencias para "${args.text}".` }];
      return [{ type: 'text', text: JSON.stringify(matches) }];
    },
  };

  const clickByText = {
    name: 'click_by_text',
    description: 'Encuentra un elemento por su texto VISIBLE y hace click en UNA sola llamada (sin snapshot ni uid). Hace scroll al elemento y dibuja el overlay del cursor de la IA. Ideal para ahorrar tokens y round-trips.',
    inputSchema: {
      type: 'object',
      required: ['text'],
      properties: {
        text:  { type: 'string',  description: 'Texto visible del elemento a clickear.' },
        exact: { type: 'boolean', description: 'Coincidencia exacta. Default false.' },
        tag:   { type: 'string',  description: 'Filtrar por tag (p.ej. "button"). Opcional.' },
        nth:   { type: 'number',  description: 'Índice si hay varias coincidencias (0 = la primera). Default 0.' },
      },
    },
    async handler(args) {
      const nth = args.nth && args.nth > 0 ? Math.floor(args.nth) : 0;
      const expr = `(function(){ ${INPAGE_HELPERS}
        var found=__collect(${JSON.stringify(String(args.text))}, ${!!args.exact}, ${selArg(args.tag)}, 0);
        var el = found[${nth}] && found[${nth}].el;
        if(!el) return JSON.stringify({found:false, count:found.length});
        el.scrollIntoView({block:'center', inline:'center'});
        var r=el.getBoundingClientRect();
        return JSON.stringify({found:true, count:found.length,
          x:Math.round(r.left+r.width/2), y:Math.round(r.top+r.height/2),
          text:__norm(el.textContent).slice(0,80), tag:el.tagName.toLowerCase()});
      })()`;
      const res = await caller.call('Runtime.evaluate', { expression: expr, returnByValue: true });
      if (res.exceptionDetails) return [{ type: 'text', text: `click_by_text error: ${res.exceptionDetails.text || 'exception'}` }];
      const info = JSON.parse(res.result?.value || '{"found":false}');
      if (!info.found) return [{ type: 'text', text: `Sin coincidencias para "${args.text}"${info.count ? ` (${info.count} candidatas descartadas)` : ''}.` }];

      // Click real via Input → viaja por el proxy → el ws-tap dibuja el overlay.
      await caller.call('Input.dispatchMouseEvent', { type: 'mouseMoved',    x: info.x, y: info.y });
      await caller.call('Input.dispatchMouseEvent', { type: 'mousePressed',  x: info.x, y: info.y, button: 'left', buttons: 1, clickCount: 1 });
      await caller.call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: info.x, y: info.y, button: 'left', buttons: 1, clickCount: 1 });

      const extra = info.count > 1 ? ` [de ${info.count} coincidencias, nth=${nth}]` : '';
      return [{ type: 'text', text: `Click en "${info.text}" (${info.tag}) @ (${info.x},${info.y})${extra}` }];
    },
  };

  const navigate = {
    name: 'navigate',
    description: 'Navega a una URL y espera de forma TOLERANTE: si el load tarda (app compilando, matriz pesada, etc.) NO falla — devuelve un soft-success con el readyState alcanzado. Evita el falso negativo por timeout de navigate_page. Para SPAs sin recarga real, usa find_by_text/wait_for sobre el elemento objetivo.',
    inputSchema: {
      type: 'object',
      required: ['url'],
      properties: {
        url:       { type: 'string', description: 'URL a la que navegar.' },
        waitUntil: { type: 'string', enum: ['interactive', 'complete'], description: 'Estado mínimo de readyState a esperar. Default interactive.' },
        timeoutMs: { type: 'number', description: 'Presupuesto de espera antes del soft-success. Default 15000.' },
      },
    },
    async handler(args) {
      const timeoutMs = args.timeoutMs && args.timeoutMs > 0 ? args.timeoutMs : 15000;
      const targets = args.waitUntil === 'complete' ? ['complete'] : ['interactive', 'complete'];

      const nav = await caller.call('Page.navigate', { url: args.url });
      if (nav && nav.errorText) return [{ type: 'text', text: `Navegación falló: ${nav.errorText} (${args.url})` }];

      const deadline = Date.now() + timeoutMs;
      let state = '';
      while (Date.now() < deadline) {
        await sleep(250);
        try {
          const res = await caller.call('Runtime.evaluate', { expression: 'document.readyState', returnByValue: true });
          state = res.result?.value || '';
        } catch { /* durante el swap de documento un tick puede fallar */ }
        if (targets.includes(state)) return [{ type: 'text', text: `Navegado a ${args.url} (readyState: ${state})` }];
      }
      return [{ type: 'text', text: `Navegado a ${args.url}; readyState "${state || '?'}" tras ${timeoutMs}ms — sin error, la página probablemente ya es usable.` }];
    },
  };

  return [findByText, clickByText, navigate];
}

module.exports = { createInteractTools };
