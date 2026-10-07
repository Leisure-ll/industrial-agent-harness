const fs = require('node:fs'),
  path = require('node:path');
const {
  toolSnapshot,
  hash,
  schemaValidator,
  REQUEST_TIMEOUT,
  externalSecrets,
} = require('./external-client.cjs');
const {
  displayInputs,
} = require('@industrial-agent-harness/domain-runtime/src/approval-preview.cjs');
const {
  runDirectory,
} = require('@industrial-agent-harness/domain-runtime/src/workspace-files.cjs');
const verifier = 'external.result.unverified';
const { ExternalSessions } = require('./external-sessions.cjs');

function createExternalRuntimePlugin({ servers, environment, registry, sessionOptions }) {
  const sessions = new ExternalSessions(environment, sessionOptions);
  return {
    dispose: () => sessions.close(),
    releaseOwner: ownerId => sessions.closeOwner(ownerId),
    tools: servers.flatMap(server =>
      server.tools.map(tool => ({
        preview: ({ inputs }) => ({
          title: `${server.title} · ${tool.name}`,
          text: externalSecrets([server], environment).reduce(
            (text, secret) => text.replaceAll(secret, '[REDACTED]'),
            JSON.stringify(displayInputs(inputs.arguments), null, 2),
          ),
        }),
        descriptor: {
          schemaVersion: '1',
          id: tool.id,
          version: server.surfaceHash,
          risk: 'mutating',
          effect: 'external',
          verification: [verifier],
        },
        guide: {
          description: tool.description,
          inputs: { arguments: tool.schema },
          providerId: server.id,
          trust:
            'User-registered host service. Roots are context, not an OS boundary. All calls require caller approval. Results are unverified observations; do not automatically retry an uncertain mutation.',
        },
        execute: async ({ inputs, projectDir, action, signal, ownerId = 'project' }) => {
          if (
            Object.keys(inputs).length !== 1 ||
            !inputs.arguments ||
            typeof inputs.arguments !== 'object' ||
            Array.isArray(inputs.arguments)
          )
            throw Error('External MCP inputs must contain exactly an arguments object.');
          if (!schemaValidator(tool.schema)(inputs.arguments))
            throw Error('External MCP arguments do not match the pinned input schema.');
          if (Buffer.byteLength(JSON.stringify(inputs.arguments)) > 262144)
            throw Error('External MCP arguments exceed 256 KiB.');
          const current = registry.records().find(item => item.id === server.id);
          if (
            !current ||
            current.revision !== server.revision ||
            current.surfaceHash !== server.surfaceHash
          ) {
            await sessions.closeServer(server.id);
            throw Error(
              'External MCP registration changed; restart the turn to resolve fresh tools.',
            );
          }
          const directory = runDirectory(projectDir, action.id);
          let connection,
            response,
            entry,
            reused,
            callStarted = false;
          try {
            ({ entry, reused } = await sessions.acquire(server, projectDir, ownerId));
            connection = entry.connection;
            const discovered = [],
              cursors = new Set();
            let cursor;
            do {
              const page = await connection.client.listTools(cursor ? { cursor } : undefined, {
                timeout: 10000,
                signal,
              });
              discovered.push(...page.tools);
              cursor = page.nextCursor;
              if (discovered.length > 128 || (cursor && cursors.has(cursor)) || cursors.size > 32)
                throw Error('External MCP surface exceeds the pinned discovery limit.');
              if (cursor) cursors.add(cursor);
            } while (cursor);
            if (hash(toolSnapshot(server.id, discovered)) !== server.surfaceHash)
              throw Error(
                'External MCP tool surface changed; refresh the registration before calling.',
              );
            if (signal.aborted) throw Error('External MCP call was cancelled before execution.');
            callStarted = true;
            const result = await connection.client.callTool(
              { name: tool.name, arguments: inputs.arguments },
              undefined,
              {
                timeout: server.config.requestTimeoutMs || REQUEST_TIMEOUT,
                maxTotalTimeout: server.config.requestTimeoutMs || REQUEST_TIMEOUT,
                signal,
              },
            );
            const serialized = JSON.stringify(result);
            if (Buffer.byteLength(serialized) > 4 * 1024 * 1024)
              throw Error(
                'External MCP result exceeded 4 MiB; the mutation may already have occurred.',
              );
            response = JSON.parse(connection.redact(serialized));
            response._harnessMcpSession = { id: entry.id, reused };
          } catch (error) {
            if (entry) await sessions.invalidate(entry);
            response = {
              isError: true,
              error: connection ? connection.redact(error.message) : String(error.message),
              uncertain: callStarted,
              advice:
                'Do not automatically retry; inspect the host service before another mutation.',
            };
          } finally {
            if (entry) sessions.release(entry);
          }
          const file = path.join(directory, 'external-result.json');
          fs.writeFileSync(file, JSON.stringify(response));
          return {
            executionSucceeded: response.isError !== true,
            artifacts: [{ kind: 'report.external', file }],
            diagnostics: response.isError
              ? [response.error || 'The external MCP service returned an error.']
              : [],
            toolVersion: server.surfaceHash,
          };
        },
      })),
    ),
    verifiers: {
      [verifier]: () => ({
        status: 'not_run',
        reason:
          'External MCP response recorded as an unverified observation. It does not establish engineering acceptance.',
        metrics: {},
      }),
    },
  };
}
module.exports = { createExternalRuntimePlugin };
