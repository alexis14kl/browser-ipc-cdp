/**
 * Tools de cobertura de código via CdpCoverage (servicio inyectado).
 *
 * El servicio maneja sesiones WS persistentes — necesarias porque
 * Profiler.enable y CSS.enable son session-scoped en CDP.
 */

function createCoverageTools({ coverage }) {
  const startJsCoverage = {
    name: 'start_js_coverage',
    description: 'Start collecting JavaScript code coverage. Run actions on the page, then call stop_js_coverage to get results.',
    inputSchema: {
      type: 'object',
      properties: {
        callCount: { type: 'boolean', description: 'Track how many times each function was called. Default: true.' },
        detailed:  { type: 'boolean', description: 'Return detailed block-level coverage. Default: true.' },
      },
    },
    async handler(args) {
      await coverage.startJs({ callCount: args.callCount !== false, detailed: args.detailed !== false });
      return [{ type: 'text', text: 'JS coverage started. Perform actions, then call stop_js_coverage.' }];
    },
  };

  const stopJsCoverage = {
    name: 'stop_js_coverage',
    description: 'Stop JS coverage and return results showing which scripts and functions were executed.',
    inputSchema: {
      type: 'object',
      properties: {
        minCoverage:  { type: 'number',  description: 'Only return scripts below this % coverage (0-100).' },
        includeEmpty: { type: 'boolean', description: 'Include anonymous scripts with 0% coverage. Default: false.' },
      },
    },
    async handler(args) {
      if (!coverage.isJsActive()) {
        return [{ type: 'text', text: 'JS coverage not active. Call start_js_coverage first.' }];
      }
      const scripts = await coverage.stopJs({ minCoverage: args.minCoverage, includeEmpty: args.includeEmpty });
      return [{ type: 'text', text: JSON.stringify(scripts, null, 2) }];
    },
  };

  const startCssCoverage = {
    name: 'start_css_coverage',
    description: 'Start collecting CSS rule usage. Run actions on the page, then call stop_css_coverage to get unused rules.',
    inputSchema: { type: 'object', properties: {} },
    async handler() {
      await coverage.startCss();
      return [{ type: 'text', text: 'CSS coverage started. Perform actions, then call stop_css_coverage.' }];
    },
  };

  const stopCssCoverage = {
    name: 'stop_css_coverage',
    description: 'Stop CSS coverage and return unused rules. Shows which CSS selectors were never matched.',
    inputSchema: {
      type: 'object',
      properties: {
        unusedOnly: { type: 'boolean', description: 'Return only unused rules. Default: true.' },
      },
    },
    async handler(args) {
      if (!coverage.isCssActive()) {
        return [{ type: 'text', text: 'CSS coverage not active. Call start_css_coverage first.' }];
      }
      const result = await coverage.stopCss({ unusedOnly: args.unusedOnly !== false });
      return [{ type: 'text', text: JSON.stringify(result, null, 2) }];
    },
  };

  return [startJsCoverage, stopJsCoverage, startCssCoverage, stopCssCoverage];
}

module.exports = { createCoverageTools };
