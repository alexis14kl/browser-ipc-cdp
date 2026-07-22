/**
 * Tools de inspección del DOM via CDP DOM domain.
 */

function createDomTools({ caller }) {
  const getDomElement = {
    name: 'get_dom_element',
    description: 'Query DOM elements by CSS selector. Returns attributes, text content, and outer HTML.',
    inputSchema: {
      type: 'object',
      required: ['selector'],
      properties: {
        selector: {
          type: 'string',
          description: 'CSS selector to query.',
        },
        multiple: {
          type: 'boolean',
          description: 'Return all matching elements instead of just the first. Default: false.',
        },
        includeHtml: {
          type: 'boolean',
          description: 'Include outerHTML in the result. Default: false.',
        },
      },
    },
    async handler(args) {
      const doc = await caller.call('DOM.getDocument', { depth: 0 });
      const rootId = doc.root.nodeId;

      if (args.multiple) {
        const { nodeIds } = await caller.call('DOM.querySelectorAll', {
          nodeId: rootId,
          selector: args.selector,
        });

        if (!nodeIds || nodeIds.length === 0) {
          return [{ type: 'text', text: 'No elements found' }];
        }

        const results = await Promise.all(nodeIds.slice(0, 50).map(async nodeId => {
          return buildElementInfo(caller, nodeId, args.includeHtml);
        }));

        return [{ type: 'text', text: JSON.stringify(results, null, 2) }];
      }

      const { nodeId } = await caller.call('DOM.querySelector', {
        nodeId: rootId,
        selector: args.selector,
      });

      if (!nodeId) {
        return [{ type: 'text', text: `No element matches: ${args.selector}` }];
      }

      const info = await buildElementInfo(caller, nodeId, args.includeHtml);
      return [{ type: 'text', text: JSON.stringify(info, null, 2) }];
    },
  };

  const scrollTo = {
    name: 'scroll_to',
    description: 'Scroll the page to a position or element. Supports smooth and instant behavior.',
    inputSchema: {
      type: 'object',
      properties: {
        selector: { type: 'string',  description: 'CSS selector to scroll into view. Takes priority over x/y.' },
        x:        { type: 'number',  description: 'Horizontal scroll position in pixels.' },
        y:        { type: 'number',  description: 'Vertical scroll position in pixels.' },
        behavior: { type: 'string',  enum: ['smooth', 'instant'], description: 'Scroll behavior. Default: smooth.' },
        block:    { type: 'string',  enum: ['start', 'center', 'end', 'nearest'], description: 'Vertical alignment when scrolling to selector. Default: center.' },
      },
    },
    async handler(args) {
      const behavior = args.behavior ?? 'smooth';

      if (args.selector) {
        const expr = `
          (function() {
            const el = document.querySelector(${JSON.stringify(args.selector)});
            if (!el) return 'Element not found: ${args.selector}';
            el.scrollIntoView({ behavior: ${JSON.stringify(behavior)}, block: ${JSON.stringify(args.block ?? 'center')} });
            return 'Scrolled to ' + ${JSON.stringify(args.selector)};
          })()
        `;
        const result = await caller.call('Runtime.evaluate', { expression: expr, returnByValue: true });
        return [{ type: 'text', text: result.result?.value ?? 'Done' }];
      }

      const x = args.x ?? 0;
      const y = args.y ?? 0;
      const expr = `window.scrollTo({ left: ${x}, top: ${y}, behavior: ${JSON.stringify(behavior)} }); 'Scrolled to x=${x}, y=${y}'`;
      const result = await caller.call('Runtime.evaluate', { expression: expr, returnByValue: true });
      return [{ type: 'text', text: result.result?.value ?? 'Done' }];
    },
  };

  return [getDomElement, scrollTo];
}

async function buildElementInfo(caller, nodeId, includeHtml) {
  const info = { nodeId };

  try {
    const { attributes } = await caller.call('DOM.getAttributes', { nodeId });
    if (attributes) {
      info.attributes = {};
      for (let i = 0; i < attributes.length; i += 2) {
        info.attributes[attributes[i]] = attributes[i + 1];
      }
    }
  } catch {}

  try {
    const { object } = await caller.call('DOM.resolveNode', { nodeId });
    if (object?.objectId) {
      const textRes = await caller.call('Runtime.callFunctionOn', {
        objectId:            object.objectId,
        functionDeclaration: 'function(){ return this.textContent; }',
        returnByValue:       true,
      });
      const text = textRes?.result?.value?.trim();
      if (text) info.textContent = text.length > 500 ? text.slice(0, 500) + '…' : text;
    }
  } catch {}

  if (includeHtml) {
    try {
      const { outerHTML } = await caller.call('DOM.getOuterHTML', { nodeId });
      info.outerHTML = outerHTML?.length > 2000 ? outerHTML.slice(0, 2000) + '…' : outerHTML;
    } catch {}
  }

  return info;
}

module.exports = { createDomTools };
