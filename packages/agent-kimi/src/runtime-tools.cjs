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
        output: JSON.stringify(runtime.describeTool(toolId, getScope())),
        message: 'Scoped industrial tool guide loaded.',
      }),
    }),
    createExternalTool({
      name: 'industrial_action_call',
      description:
        'Execute an allowed canonical industrial Tool through the persistent host runtime. Requires the current DomainState identity. Read acceptance from verification, and use returned state/checkpoint identities.',
      parameters: z.object({
        toolId: z.string().min(1),
        inputs: z.record(z.string(), z.unknown()),
        expectedStateId: z.string().uuid(),
      }),
      handler: async request => {
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
