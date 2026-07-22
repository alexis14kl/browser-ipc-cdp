/**
 * Tool de árbol de accesibilidad via CDP Accessibility domain.
 */

function createAccessibilityTools({ caller }) {
  const getAccessibilityTree = {
    name: 'get_accessibility_tree',
    description: 'Returns the accessibility tree of the current page. Useful for understanding page structure and finding elements.',
    inputSchema: {
      type: 'object',
      properties: {
        interestingOnly: {
          type: 'boolean',
          description: 'Return only nodes with roles/names relevant to interaction. Default: true.',
        },
        depth: {
          type: 'number',
          description: 'Max tree depth to return (default: 5). Use -1 for unlimited.',
        },
      },
    },
    async handler(args) {
      const interestingOnly = args.interestingOnly !== false;
      const maxDepth = args.depth ?? 5;

      const result = await caller.call('Accessibility.getFullAXTree', {});
      if (!result || !result.nodes) throw new Error('No accessibility data returned');

      // Build id→node map and filter/trim
      const nodeMap = new Map(result.nodes.map(n => [n.nodeId, n]));

      function summarize(node, depth) {
        if (!node) return null;
        if (maxDepth !== -1 && depth > maxDepth) return null;

        const role = node.role?.value;
        const name = node.name?.value || '';

        if (interestingOnly && (!role || role === 'none' || role === 'generic')) {
          // recurse children but don't emit this node
          return (node.childIds || [])
            .map(id => summarize(nodeMap.get(id), depth))
            .filter(Boolean)
            .flat();
        }

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
      const tree = roots.flatMap(r => summarize(r, 0) || []);
      return [{ type: 'text', text: JSON.stringify(tree, null, 2) }];
    },
  };

  return [getAccessibilityTree];
}

module.exports = { createAccessibilityTools };
