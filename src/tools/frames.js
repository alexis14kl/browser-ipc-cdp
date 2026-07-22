/**
 * Inspección de iframes via CDP Page domain.
 * get_frames: árbol de frames de la página.
 * evaluate_in_frame: evalúa JS en un iframe específico (mundo aislado).
 */

function createFrameTools({ caller }) {
  const getFrames = {
    name: 'get_frames',
    description: 'Returns the frame tree of the current page (main frame + all iframes) with id, url, name and depth.',
    inputSchema: { type: 'object', properties: {} },
    async handler() {
      const { frameTree } = await caller.call('Page.getFrameTree');

      function flatten(node, depth = 0) {
        const { frame, childFrames = [] } = node;
        return [
          { id: frame.id, url: frame.url, name: frame.name ?? '', depth },
          ...childFrames.flatMap(c => flatten(c, depth + 1)),
        ];
      }

      const frames = flatten(frameTree);
      return [{ type: 'text', text: JSON.stringify(frames, null, 2) }];
    },
  };

  const evaluateInFrame = {
    name: 'evaluate_in_frame',
    description: 'Evaluates a JavaScript expression inside a specific iframe. Get frameId with get_frames first.',
    inputSchema: {
      type: 'object',
      required: ['frameId', 'expression'],
      properties: {
        frameId:    { type: 'string', description: 'Frame ID from get_frames' },
        expression: { type: 'string', description: 'JS expression to evaluate' },
      },
    },
    async handler(args) {
      // Crea un contexto aislado en el frame objetivo
      const { executionContextId } = await caller.call('Page.createIsolatedWorld', {
        frameId:    args.frameId,
        worldName:  '__mcp_frame_eval__',
      });

      const result = await caller.call('Runtime.evaluate', {
        expression:    args.expression,
        contextId:     executionContextId,
        returnByValue: true,
        awaitPromise:  true,
      });

      if (result.exceptionDetails) {
        throw new Error(
          result.exceptionDetails.exception?.description
          ?? result.exceptionDetails.text
          ?? 'Error en el frame'
        );
      }

      const val = result.result?.value;
      return [{ type: 'text', text: JSON.stringify(val, null, 2) }];
    },
  };

  return [getFrames, evaluateInFrame];
}

module.exports = { createFrameTools };
