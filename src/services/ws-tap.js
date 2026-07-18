/**
 * WS Tap — decodificador de frames WebSocket SOLO-OBSERVACIÓN.
 *
 * El proxy CDP tunelea el WebSocket cliente(chrome-devtools-mcp)↔navegador con
 * un pipe TCP crudo. Este módulo permite ESPIAR una copia de ese stream (sin
 * modificarlo) para extraer los `Input.dispatchMouseEvent` que manda la IA:
 * esa es la única señal que distingue el mouse de la IA del mouse físico del
 * usuario (ambos llegan al DOM con isTrusted:true; aquí, en cambio, el mouse
 * físico NUNCA aparece porque no viaja por CDP).
 *
 * Diseño defensivo: nunca escribe de vuelta al túnel. Un bug aquí, como mucho,
 * hace que el overlay no dibuje — jamás corrompe la conexión CDP.
 *
 * Cubre el caso común de CDP: frames de texto (opcode 0x1) sin fragmentar,
 * enmascarados (client→server siempre lo están). La fragmentación (opcode 0x0)
 * se ignora: los mensajes CDP de Input caben de sobra en un frame.
 */

const MAX_BUFFER = 2 * 1024 * 1024; // corta el buffer si un peer manda basura

/**
 * Crea un decodificador incremental de frames WS. Llama a `onText(str)` por
 * cada frame de texto completo. Tolera frames partidos entre chunks TCP.
 * @param {(text: string) => void} onText
 * @returns {(chunk: Buffer) => void} feed
 */
function createWsFrameDecoder(onText) {
  let buf = Buffer.alloc(0);
  return function feed(chunk) {
    buf = buf.length ? Buffer.concat([buf, chunk]) : chunk;
    if (buf.length > MAX_BUFFER) buf = buf.subarray(buf.length - 1024 * 1024);

    while (buf.length >= 2) {
      const b0 = buf[0];
      const b1 = buf[1];
      const opcode = b0 & 0x0f;
      const masked = (b1 & 0x80) !== 0;
      let len = b1 & 0x7f;
      let offset = 2;

      if (len === 126) {
        if (buf.length < 4) return;
        len = buf.readUInt16BE(2);
        offset = 4;
      } else if (len === 127) {
        if (buf.length < 10) return;
        const big = buf.readBigUInt64BE(2);
        if (big > BigInt(MAX_BUFFER)) { buf = Buffer.alloc(0); return; } // frame absurdo
        len = Number(big);
        offset = 10;
      }

      let maskKey = null;
      if (masked) {
        if (buf.length < offset + 4) return;
        maskKey = buf.subarray(offset, offset + 4);
        offset += 4;
      }

      if (buf.length < offset + len) return; // frame incompleto: esperar más chunks

      let payload = buf.subarray(offset, offset + len);
      if (maskKey) {
        const out = Buffer.allocUnsafe(len);
        for (let i = 0; i < len; i++) out[i] = payload[i] ^ maskKey[i & 3];
        payload = out;
      }
      buf = buf.subarray(offset + len);

      if (opcode === 0x1) {
        try { onText(payload.toString('utf8')); } catch { /* observe-only */ }
      }
      // binario / continuación / control (ping/pong/close): irrelevantes aquí
    }
  };
}

/**
 * Tap especializado: decodifica frames y emite SOLO los mouse-input de la IA.
 * @param {(evt: {type: string, x: number, y: number, button?: string}) => void} onInput
 * @returns {(chunk: Buffer) => void} feed
 */
function createInputTap(onInput) {
  return createWsFrameDecoder((text) => {
    if (text.indexOf('Input.dispatchMouseEvent') === -1) return; // fast-path
    let msg;
    try { msg = JSON.parse(text); } catch { return; }
    if (!msg || msg.method !== 'Input.dispatchMouseEvent' || !msg.params) return;
    const p = msg.params;
    if (typeof p.x !== 'number' || typeof p.y !== 'number') return;
    onInput({ type: p.type, x: p.x, y: p.y, button: p.button });
  });
}

module.exports = { createWsFrameDecoder, createInputTap };
