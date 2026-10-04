const { createExternalTool } = require('@moonshot-ai/kimi-agent-sdk');
const { z } = require('zod');

function runtimeTools(runtime, getScope, approve, onResult = () => {}) {
  if (!runtime) return [];
  return [
    createExternalTool({
      name: 'industrial_tool_describe',
      description:
        'Load the input guide and example for one canonical Tool in the current Broker allowlist before calling it. This is documentation, not engineering evidence.',
      parameters: z.object({ toolId: z.string().min(1) }),
      handler: async ({ toolId }) => ({
        output: JSON.stringify({
          ...runtime.describeTool(toolId, getScope()),
          actionTransport:
            'Prefer industrial_action_call.inputsJson: serialize the declared inputs as a JSON string, preserving JSON numbers and arrays. Do not copy example values as user requirements.',
        }),
        message: 'Scoped industrial tool guide loaded.',
      }),
    }),
    createExternalTool({
      name: 'industrial_action_call',
      description:
        'Execute an allowed canonical industrial Tool through the persistent host runtime. Prefer inputsJson containing the declared inputs encoded as a JSON string so nested arrays and numbers retain their types. Supply exactly one of inputsJson or inputs. Requires the current DomainState identity. Read acceptance from verification and use returned state/checkpoint identities.',
      parameters: z.object({
        toolId: z.string().min(1),
        inputs: z.record(z.string(), z.unknown()).optional(),
        inputsJson: z.string().max(262144).optional(),
        expectedStateId: z.string().uuid(),
      }),
      handler: async request => {
        if ((request.inputs !== undefined) === (request.inputsJson !== undefined))
          throw Error('Supply exactly one of inputs or inputsJson.');
        if (request.inputsJson !== undefined) {
          if (typeof request.inputsJson !== 'string' || request.inputsJson.length > 262144)
            throw Error('inputsJson must be a JSON string within 256 KiB.');
          let inputs;
          try {
            inputs = JSON.parse(request.inputsJson);
          } catch {
            throw Error('inputsJson must contain valid JSON.');
          }
          if (!inputs || typeof inputs !== 'object' || Array.isArray(inputs))
            throw Error('inputsJson must encode an object.');
          request = { toolId: request.toolId, expectedStateId: request.expectedStateId, inputs };
        }
        const descriptor = runtime.descriptors().find(item => item.id === request.toolId);
        const scope = getScope();
        // Unknown/stale scopes still enter Runtime to record the rejected attempt.
        const inScope = Boolean(scope?.tools.includes(request.toolId));
        const approval =
          descriptor?.risk !== 'mutating' ? true : inScope && (await approve(descriptor, request));
        const result = await runtime.execute(request, { scope: getScope(), approval });
        await onResult(result);
        const output = JSON.stringify({
          runId: result.run.id,
          actionId: result.action.id,
          actionStatus: result.action.status,
          artifactSet: result.artifacts.map(({ id, kind, sha256, relativePath }) => ({
            id,
            kind,
            sha256,
            relativePath,
          })),
          verification: result.verification,
          stateId: result.state.id,
          stateStatus: result.state.status,
          checkpointId: result.checkpoint.id,
          diagnostics: result.action.diagnostics,
        });
        return { output, message: result.verification.reason };
      },
    }),
  ];
}
module.exports = { runtimeTools };
