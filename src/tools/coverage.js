/**
 * Tools de cobertura de código via CDP Profiler y CSS domains.
 *
 * JS Coverage:  Profiler.startPreciseCoverage → Profiler.takePreciseCoverage
 * CSS Coverage: CSS.startRuleUsageTracking   → CSS.takeCoverageDelta
 *
 * Flujo: start → (navegacion/acciones del usuario o la IA) → stop
 */

function createCoverageTools({ caller }) {
  const startJsCoverage = {
    name: 'start_js_coverage',
    description: 'Start collecting JavaScript code coverage. Run actions on the page, then call stop_js_coverage to get results.',
    inputSchema: {
      type: 'object',
      properties: {
        callCount: { type: 'boolean', description: 'Track how many times each function was called. Default: true.' },
        detailed:  { type: 'boolean', description: 'Return detailed block-level coverage instead of function-level. Default: true.' },
      },
    },
    async handler(args) {
      await caller.call('Profiler.enable', {});
      await caller.call('Profiler.startPreciseCoverage', {
        callCount: args.callCount !== false,
        detailed:  args.detailed  !== false,
      });
      return [{ type: 'text', text: 'JS coverage started. Perform actions, then call stop_js_coverage.' }];
    },
  };

  const stopJsCoverage = {
    name: 'stop_js_coverage',
    description: 'Stop JS coverage collection and return results. Shows which scripts and functions were executed.',
    inputSchema: {
      type: 'object',
      properties: {
        minCoverage: { type: 'number', description: 'Only return scripts with coverage below this % (0-100). Omit to return all.' },
        includeEmpty: { type: 'boolean', description: 'Include scripts with 0% coverage. Default: false.' },
      },
    },
    async handler(args) {
      const { result } = await caller.call('Profiler.takePreciseCoverage', {});
      await caller.call('Profiler.stopPreciseCoverage', {});
      await caller.call('Profiler.disable', {});

      const scripts = (result || [])
        .map(script => {
          const totalRanges = script.functions.reduce((acc, fn) => acc + fn.ranges.length, 0);
          const coveredRanges = script.functions.reduce(
            (acc, fn) => acc + fn.ranges.filter(r => r.count > 0).length, 0
          );
          const pct = totalRanges > 0 ? Math.round((coveredRanges / totalRanges) * 100) : 0;
          return { url: script.url || '(anonymous)', coveragePct: pct, functions: script.functions.length };
        })
        .filter(s => {
          if (!args.includeEmpty && s.coveragePct === 0 && !s.url.startsWith('http')) return false;
          if (args.minCoverage != null && s.coveragePct >= args.minCoverage) return false;
          return true;
        })
        .sort((a, b) => a.coveragePct - b.coveragePct);

      return [{ type: 'text', text: JSON.stringify(scripts, null, 2) }];
    },
  };

  const startCssCoverage = {
    name: 'start_css_coverage',
    description: 'Start collecting CSS rule usage. Run actions on the page, then call stop_css_coverage to get unused rules.',
    inputSchema: { type: 'object', properties: {} },
    async handler() {
      await caller.call('CSS.enable', {});
      await caller.call('CSS.startRuleUsageTracking', {});
      return [{ type: 'text', text: 'CSS coverage started. Perform actions, then call stop_css_coverage.' }];
    },
  };

  const stopCssCoverage = {
    name: 'stop_css_coverage',
    description: 'Stop CSS coverage and return unused rules. Shows which CSS selectors were never matched during the session.',
    inputSchema: {
      type: 'object',
      properties: {
        unusedOnly: { type: 'boolean', description: 'Return only unused rules (used: false). Default: true.' },
      },
    },
    async handler(args) {
      const { ruleUsage } = await caller.call('CSS.takeCoverageDelta', {});
      await caller.call('CSS.stopRuleUsageTracking', {});

      const unusedOnly = args.unusedOnly !== false;
      const rules = (ruleUsage || []).filter(r => !unusedOnly || !r.used);

      const summary = {
        total:   ruleUsage?.length ?? 0,
        used:    ruleUsage?.filter(r => r.used).length ?? 0,
        unused:  ruleUsage?.filter(r => !r.used).length ?? 0,
        rules:   rules.slice(0, 200),
      };

      return [{ type: 'text', text: JSON.stringify(summary, null, 2) }];
    },
  };

  return [startJsCoverage, stopJsCoverage, startCssCoverage, stopCssCoverage];
}

module.exports = { createCoverageTools };
