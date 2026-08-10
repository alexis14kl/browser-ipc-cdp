/**
 * Shutdown — registro de limpiezas que DEBEN correr antes de que el proceso muera.
 *
 * Por qué existe: el interceptor y cdp-fetch dejan el dominio Fetch HABILITADO en
 * el navegador. Si el MCP muere sin llamar a stop(), las requests que estaban
 * pausadas en ese momento quedan colgadas y la pestaña se queda a medio cargar
 * (el usuario lo ve como "el navegador se quedó sin internet"). `process.exit()`
 * no ejecuta nada, así que las DOS rutas de muerte tienen que pasar por aquí:
 *   - señal del host MCP (SIGTERM/SIGINT al cerrar Claude Code),
 *   - el hijo chrome-devtools-mcp que termina y arrastra al launcher.
 *
 * `process.*` llega por inyección: el composition root es el único que pasa los
 * de verdad, y los tests pasan seams falsos (sin señales ni exit real).
 *
 * @param {object} [deps]
 * @param {(msg: string) => void} [deps.log]
 * @param {(event: string, handler: () => void) => void} [deps.on] - process.on
 * @param {(code: number) => void} [deps.exit] - process.exit
 * @param {number} [deps.timeoutMs] - Presupuesto total de la limpieza.
 */
function createShutdown({ log = () => {}, on = null, exit = null, timeoutMs = 1500 } = {}) {
  const handlers = [];
  let ran = false;

  /** Registra una limpieza. `fn` puede ser sync o async; si lanza, se loguea. */
  function add(name, fn) {
    handlers.push({ name, fn });
  }

  /**
   * Corre todas las limpiezas. Idempotente: las dos rutas de muerte pueden
   * dispararla a la vez (señal + exit del hijo) y solo la primera ejecuta.
   * @returns {Promise<boolean>} true si esta llamada fue la que limpió.
   */
  async function run(reason = 'exit') {
    if (ran) return false;
    ran = true;
    if (!handlers.length) return true;

    log(`shutdown (${reason}): limpiando ${handlers.length} servicio(s)`);

    const all = Promise.all(handlers.map(async ({ name, fn }) => {
      try { await fn(); } catch (e) { log(`shutdown: ${name} falló (${e.message})`); }
    }));

    // Con presupuesto: una limpieza colgada NO puede impedir la salida. El
    // cliente ya cerró la sesión; quedarse vivo para siempre sería peor que
    // dejar algo sin revertir.
    let timer = null;
    await Promise.race([
      all,
      new Promise((resolve) => {
        timer = setTimeout(() => { log(`shutdown: timeout de ${timeoutMs}ms, saliendo`); resolve(); }, timeoutMs);
      }),
    ]);
    if (timer) clearTimeout(timer);
    return true;
  }

  /** Engancha las señales con las que el host MCP nos cierra. */
  function install(signals = ['SIGINT', 'SIGTERM']) {
    if (!on || !exit) return false;
    for (const sig of signals) {
      on(sig, () => { run(sig).then(() => exit(0)); });
    }
    return true;
  }

  return { add, run, install, get size() { return handlers.length; } };
}

module.exports = { createShutdown };
