/**
 * Tool de árbol de accesibilidad via CDP Accessibility domain.
 */

const NOISE_ROLES = new Set(['LineBreak', 'InlineTextBox']);
const CLEAN_ROLES = new Set([
  'button', 'link', 'textbox', 'combobox', 'listbox', 'option',
  'checkbox', 'radio', 'menuitem', 'tab', 'heading', 'img',
  'form', 'dialog', 'alert', 'navigation', 'main', 'search',
]);

function createAccessibilityTools({ caller }) {
  const getAccessibilityTree = {
    name: 'get_accessibility_tree',
    description: 'Returns the accessibility tree of the current page. Useful for understanding page structure and finding interactive elements.',
    inputSchema: {
      type: 'object',
      properties: {
        interestingOnly: {
          type: 'boolean',
          description: 'Skip structural-only nodes (role=none/generic). Default: true.',
        },
        depth: {
          type: 'number',
          description: 'Max tree depth (default: 5). Use -1 for unlimited.',
        },
        format: {
          type: 'string',
          enum: ['raw', 'clean', 'markdown'],
          description: '"raw": full JSON. "clean": interactive+heading nodes only (default). "markdown": indented AI-readable tree.',
        },
        excludeFooter: {
          type: 'boolean',
          description: 'Exclude contentinfo (footer) nodes. Default: true.',
        },
      },
    },
    async handler(args) {
      const interestingOnly = args.interestingOnly !== false;
      const maxDepth        = args.depth ?? 5;
      const format          = args.format ?? 'clean';
      const excludeFooter   = args.excludeFooter !== false;

      let pageUrl = '';
      try {
        const urlResult = await caller.call('Runtime.evaluate', { expression: 'document.URL', returnByValue: true });
        pageUrl = urlResult?.result?.value || '';
      } catch (_) {}

      const result = await caller.call('Accessibility.getFullAXTree', {});
      if (!result || !result.nodes) throw new Error('No accessibility data returned');

      const nodeMap = new Map(result.nodes.map(n => [n.nodeId, n]));

      function summarize(node, depth) {
        if (!node) return null;
        if (maxDepth !== -1 && depth > maxDepth) return null;

        const role = node.role?.value;
        const name = node.name?.value || '';

        if (excludeFooter && role === 'contentinfo') return null;
        if (NOISE_ROLES.has(role)) return null;
        if (role === 'StaticText' && !name) return null;

        const recurseOnly = () =>
          (node.childIds || []).map(id => summarize(nodeMap.get(id), depth)).filter(Boolean).flat();

        if (interestingOnly && (!role || role === 'none' || role === 'generic')) return recurseOnly();
        if (format === 'clean' && !CLEAN_ROLES.has(role)) return recurseOnly();

        const out = { role };
        if (name) out.name = name;
        if (node.description?.value) out.description = node.description.value;
        if (node.value?.value != null) out.value = node.value.value;

        const children = (node.childIds || [])
          .map(id => summarize(nodeMap.get(id), depth + 1))
          .filter(Boolean)
          .flat();
        if (children.length) out.children = children;
        return [out];
      }

      const roots = result.nodes.filter(n => !result.nodes.some(p => (p.childIds || []).includes(n.nodeId)));
      const tree  = roots.flatMap(r => summarize(r, 0) || []);

      let text;
      if (format === 'markdown') {
        text = `# AXTree: ${pageUrl}\n\n` + toMarkdown(tree, 0);
      } else {
        text = JSON.stringify({ url: pageUrl, tree }, null, 2);
      }

      return [{ type: 'text', text }];
    },
  };

  return [getAccessibilityTree];
}

function toMarkdown(nodes, indent) {
  if (!nodes?.length) return '';
  return nodes.map(node => {
    const pad  = '  '.repeat(indent);
    const name = node.name  ? ` "${node.name}"` : '';
    const val  = node.value != null ? ` = ${node.value}` : '';
    const desc = node.description ? ` (${node.description})` : '';
    const line = `${pad}- [${node.role}]${name}${val}${desc}`;
    const kids = toMarkdown(node.children, indent + 1);
    return kids ? line + '\n' + kids : line;
  }).join('\n');
}

module.exports = { createAccessibilityTools };
