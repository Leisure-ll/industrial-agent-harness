#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { parseArgs } = require('./args.cjs');
const {
  resolveProjectTask,
  createProjectRuntime,
  effectiveCapabilities,
  resourceCatalog,
  ResourceSettings,
  defaultResourceDirectory,
  ChatStore,
  defaultChatDirectory,
  ExternalMcpRegistry,
  SessionResourceManager,
} = require('@industrial-agent-harness/harness-core');
const { loadRegistry, distributionDomain } = require('@industrial-agent-harness/domain-skills');
const { discloseDetail } = require('@industrial-agent-harness/capability-broker');
const { KimiSession } = require('@industrial-agent-harness/agent-kimi');
const {
  createGuiPlugin,
  ensureInstalled,
} = require('@industrial-agent-harness/computer-use-bridge');
const { ObservedContextStore } = require('@industrial-agent-harness/domain-runtime');
const { runBench } = require('./bench.cjs');
const { loadArtifacts } = require('./lib/artifact-manifest.cjs');
const { runMcp } = require('./mcp.cjs');
const { main: inspectDiagnosticLog } = require('./inspect-log.cjs');
const { runDomains } = require('./domains.cjs');
const { PackManager } = require('@industrial-agent-harness/pack-manager');
const {
  defaults,
  validateProfile,
  sessionEnv,
  writeCliConfig,
} = require('@industrial-agent-harness/agent-kimi/src/model-config.cjs');

const usage = `industrial-harness run --project-dir DIR --domain DOMAIN (--task TEXT | --task-file FILE) [options]
industrial-harness chats --project-dir DIR --domain DOMAIN [--chat-dir DIR]
industrial-harness inspect-log --file FILE
industrial-harness mcp --help
industrial-harness domains list|available|install|update|remove [options]

Options:
  --chat-id ID                 Continue an existing project chat
  --chat-dir DIR               Shared chat database and agent session directory
  --scope-only                 Resolve Broker scope without starting Kimi
  --provider NAME              kimi or openai_legacy
  --endpoint URL               Model API base URL
  --model NAME                 Model name
  --context-size N             Model context size
  --no-thinking                Disable thinking mode
  --image-input                Enable model image input for screenshot services
  --api-key-env NAME           Environment variable containing the API key
  --kimi-executable PATH       Kimi CLI executable (or set KIMI_EXECUTABLE)
  --approval POLICY            reject (default), approve, approve_for_session, auto
  --enable-gui                 Enable the computer-use plugin (installs the engine on first use)
  --artifact-manifest FILE     JSON array of {id, kind, path} inside the project
  --state-dir DIR             Durable observed-context database directory
  --log-dir DIR               Full diagnostic JSONL directory
  --disable-skill ID          Disable a repository skill for this run (repeatable)
  --disable-mcp ID            Disable a repository MCP server for this run (repeatable)
  --timeout-ms N               Interrupt a turn after N milliseconds

Global/project resource defaults use ~/.industrial-agent-harness/resource-settings.json.
Set INDUSTRIAL_HARNESS_CONFIG_DIR to use an isolated configuration directory.
Output is JSON Lines on stdout. API keys are read only from the environment.\n`;

function emit(output, event) {
  output.write(`${JSON.stringify({ schemaVersion: 1, ...event })}\n`);
}

async function run(
  options,
  output = process.stdout,
  environment = process.env,
  Session = KimiSession,
) {
  let bundle;
  const store =
    options.scopeOnly && options.command !== 'chats'
      ? null
      : new ChatStore(options.chatDir || defaultChatDirectory(environment));
  try {
    const registry = loadRegistry(environment);
    if (!registry.domains.some(item => item.id === options.domain))
      throw Error('Choose a valid project domain.');
    if (options.command !== 'chats' && !options.scopeOnly)
      bundle = createProjectRuntime({
        projectDir: fs.realpathSync(path.resolve(options.projectDir)),
        domain: options.domain,
        directory: options.stateDir || environment.INDUSTRIAL_HARNESS_STATE_DIR,
        environment,
        registry,
      });
    return await runWithStore(options, output, environment, Session, store, registry, bundle);
  } finally {
    try {
      bundle?.runtime.close();
    } finally {
      store?.close();
    }
  }
}

async function runWithStore(options, output, environment, Session, chats, registry, bundle) {
  const capabilities = [...registry.capabilities, ...(bundle?.capabilities || [])];
  const projectDir = fs.realpathSync(path.resolve(options.projectDir));
  if (!fs.statSync(projectDir).isDirectory()) throw Error('Project path must be a directory.');
  const runId = crypto.randomUUID();
  const send = event => emit(output, { runId, ...event });
  if (!registry.domains.some(item => item.id === options.domain))
    throw Error('Choose a valid project domain.');
  if (options.command === 'chats') {
    send({ type: 'chats', chats: chats.list(projectDir, options.domain) });
    return 0;
  }
  const previous =
    options.chatId && chats
      ? chats.history(options.chatId, projectDir, options.domain).turns.at(-1)?.broker?.scope
      : undefined;
  const externalServers = new ExternalMcpRegistry(defaultResourceDirectory(environment)).records();
  const catalog = resourceCatalog(options.domain, externalServers);
  const saved = new ResourceSettings(defaultResourceDirectory(environment)).snapshot(
    catalog,
    projectDir,
  ).effective;
  const disabled = {
    skills: [...new Set([...saved.skills, ...(options.disabledSkills || [])])],
    mcpServers: [...new Set([...saved.mcpServers, ...(options.disabledMcpServers || [])])],
  };
  for (const id of disabled.skills)
    if (!catalog.skills.some(item => item.id === id)) throw Error(`Unknown project skill: ${id}`);
  for (const id of disabled.mcpServers)
    if (!catalog.mcpServers.some(item => item.id === id)) throw Error(`Unknown project MCP: ${id}`);
  const broker = resolveProjectTask(
    options.domain,
    { task: options.task, ...(bundle ? { state: await bundle.runtime.inspect() } : {}) },
    previous,
    capabilities,
    disabled,
    externalServers,
    registry.domains,
    { protectedIndustrial: Session === KimiSession },
  );
  const scope = broker.scope;
  send({
    type: 'scope',
    projectDir,
    scope,
    matches: broker.matches,
    trace: broker.trace,
    ...(options.scopeOnly ? { preview: true, executionAuthorized: false } : {}),
  });
  if (options.scopeOnly) {
    send({ type: 'result', status: 'scoped' });
    return 0;
  }

  const provider = options.provider || 'kimi';
  if (provider === 'openai_legacy' && !options.endpoint && !environment.OPENAI_BASE_URL)
    throw Error('Set --endpoint or OPENAI_BASE_URL for the OpenAI-compatible provider.');
  const profile = validateProfile({
    ...defaults,
    provider,
    endpoint:
      options.endpoint ||
      (provider === 'kimi' ? environment.KIMI_BASE_URL : environment.OPENAI_BASE_URL) ||
      defaults.endpoint,
    model: options.model || environment.KIMI_MODEL_NAME || defaults.model,
    contextSize: options.contextSize || defaults.contextSize,
    thinking: options.thinking,
    imageInput: Boolean(options.imageInput),
    imageInputMode: options.imageInput ? 'enabled' : defaults.imageInputMode,
  });
  const keyName = options.apiKeyEnv || (provider === 'kimi' ? 'KIMI_API_KEY' : 'OPENAI_API_KEY');
  const apiKey = environment[keyName];
  if (!apiKey) throw Error(`Set ${keyName} in the environment before running Kimi.`);
  const artifacts = await loadArtifacts(options.artifactManifest, projectDir);
  const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'industrial-harness-cli-'));
  fs.chmodSync(configDir, 0o700);
  let session;
  let contextStore;
  let timeout;
  let timedOut = false;
  let interrupted = false;
  let outcome;
  let pendingQuestion;
  let completedStatus;
  let turnId;
  let release;
  let guiBridge;
  let sessionResources;
  const chat = options.chatId
    ? chats.get(options.chatId, projectDir, options.domain)
    : chats.create(projectDir, options.domain);
  let releasePack;
  const onInterrupt = signal => {
    interrupted = true;
    send({ type: 'interrupted', signal });
    Promise.resolve(session?.interrupt()).catch(error =>
      send({ type: 'interrupt_error', message: String(error) }),
    );
  };
  const onSigint = () => onInterrupt('SIGINT');
  const onSigterm = () => onInterrupt('SIGTERM');
  try {
    sessionResources = new SessionResourceManager({ environment });
    releasePack = process.env.INDUSTRIAL_HARNESS_PACK_STORE
      ? new PackManager().acquireUse(options.domain)
      : null;
    release = chats.acquire(chat.id);
    chats.recoverInterrupted();
    turnId = chats.beginTurn(chat.id, options.task, broker);
    send({ type: 'chat', chatId: chat.id });
    contextStore = new ObservedContextStore(projectDir, options.domain, {
      directory: options.stateDir || environment.INDUSTRIAL_HARNESS_STATE_DIR,
    });
    for (const [id, item] of artifacts)
      await contextStore.observeArtifact({ id, kind: item.metadata.kind, file: item.file });
    const runtime = {
      profile,
      apiKey,
      revision: 0,
      executable: options.kimiExecutable || environment.KIMI_EXECUTABLE || 'kimi',
      shareDir: writeCliConfig(configDir, profile),
      env: sessionEnv(profile, apiKey),
      disabledMcpServers: disabled.mcpServers,
      environment,
      externalServers,
      approvalMode: options.approval === 'auto' ? 'auto' : 'ask',
    };
    const protectedIndustrial = Boolean(bundle || Session === KimiSession);
    if (options.enableGui && protectedIndustrial)
      send({
        type: 'execution_policy',
        unavailable: ['application-control'],
        reason:
          'Application control is unavailable in protected industrial execution; project inspection and registered Runtime tools remain available.',
      });
    if (options.enableGui && !protectedIndustrial) {
      const guiDir =
        environment.GUI_BRIDGE_DIR ||
        path.join(os.homedir(), '.industrial-agent-harness', 'gui-bridge');
      send({ type: 'gui_install', phase: 'checking' });
      try {
        const installed = await ensureInstalled(guiDir, environment, (phase, detail) =>
          send({ type: 'gui_install', phase, tag: detail?.tag || null }),
        );
        send({
          type: 'gui_install',
          phase: 'ready',
          tag: installed.tag,
          cached: Boolean(installed.cached),
        });
      } catch (error) {
        send({ type: 'gui_install', phase: 'error', error: String(error) });
        throw Error(
          `Computer-use plugin is not available: ${String(error)}. Run again after the install succeeds, or set GUI_BRIDGE_BIN to an existing binary.`,
        );
      }
      guiBridge = createGuiPlugin({
        enabled: true,
        installedDir: guiDir,
        log: (canonicalId, risk, args, info) =>
          broker.trace.push({
            level: 'L2',
            event: 'plugin.tool-call',
            detail: { plugin: 'computer-use', tool: canonicalId, risk, args, ...info },
          }),
      });
    }
    const plugins = guiBridge ? [guiBridge] : [];
    session = new Session(
      projectDir,
      () => scope,
      async id => {
        return contextStore.readArtifact(id);
      },
      id => {
        const detail = discloseDetail(scope, effectiveCapabilities(capabilities, disabled), id);
        send({
          type: 'disclosure',
          level: 'L3',
          capabilityId: id,
          skills: detail.skills.map(item => item.id),
          tools: detail.tools.map(item => item.id),
        });
        return detail;
      },
      event => {
        chats.append(event.turnId || turnId, event);
        send({ type: 'agent_event', event });
        if (event.type === 'done' || event.type === 'error') outcome = event;
        if (event.type === 'approval') {
          const decision = options.approval || 'reject';
          send({ type: 'approval_decision', id: event.id, decision });
          queueMicrotask(() => {
            Promise.resolve()
              .then(() => session.approve(event.id, decision))
              .catch(error =>
                send({ type: 'approval_error', id: event.id, message: String(error) }),
              );
          });
        }
        if (event.type === 'question') {
          // No human input channel exists in this JSONL process. Preserve the
          // request and stop; an empty answer can be mistaken for permission.
          pendingQuestion = event;
          send({ type: 'needs_input', id: event.id, questions: event.questions });
          queueMicrotask(() => {
            Promise.resolve()
              .then(() => session.interrupt())
              .catch(error => send({ type: 'interrupt_error', message: String(error) }));
          });
        }
      },
      () => runtime,
      undefined,
      {
        industrialRuntime: bundle?.runtime,
        protectedPaths: bundle?.protectedPaths,
        onIndustrialResult: result => {
          scope.stateId = result.state.id;
          const event = { type: 'industrial_result', ...result };
          chats.append(turnId, event);
          send(event);
        },
        resources: sessionResources,
        directory: options.logDir || environment.INDUSTRIAL_HARNESS_LOG_DIR,
        getBrokerTrace: () => broker.trace,
        getContextAnchor: () => contextStore.anchor(),
        readContextPage: (checkpointId, offset, limit) =>
          contextStore.readPage(checkpointId, offset, limit),
        resolveSession: key => chats.runtimeSession(chat.id, key),
        sessionInitialized: id => chats.initialized(id),
        resolveToolTurn: (callId, createdAt) => chats.toolCallTurn(chat.id, callId, createdAt),
      },
      plugins,
    );
    process.once('SIGINT', onSigint);
    process.once('SIGTERM', onSigterm);
    if (options.timeoutMs)
      timeout = setTimeout(() => {
        timedOut = true;
        send({ type: 'timeout', timeoutMs: Number(options.timeoutMs) });
        Promise.resolve(session.interrupt()).catch(error =>
          send({ type: 'interrupt_error', message: String(error) }),
        );
      }, Number(options.timeoutMs));
    await session.run(options.task, [], { turnId });
    const status = timedOut
      ? 'timeout'
      : pendingQuestion
        ? 'needs_input'
        : interrupted
          ? 'interrupted'
          : outcome?.type === 'error'
            ? 'error'
            : outcome?.type === 'done'
              ? outcome.result.status
              : 'incomplete';
    chats.finish(turnId, status);
    completedStatus = status;
    const state = bundle ? await bundle.runtime.inspect() : null;
    send({
      type: 'result',
      status,
      chatId: chat.id,
      ...(state
        ? {
            engineering: {
              stateId: state.id,
              status: state.status,
              checkpointId: bundle.runtime.latestCheckpoint()?.id,
            },
          }
        : {}),
    });
    return status === 'timeout'
      ? 124
      : status === 'needs_input'
        ? 2
        : status === 'interrupted'
          ? 130
          : status === 'error' || status === 'incomplete'
            ? 1
            : 0;
  } finally {
    if (timeout) clearTimeout(timeout);
    process.removeListener('SIGINT', onSigint);
    process.removeListener('SIGTERM', onSigterm);
    try {
      await session?.close();
    } finally {
      if (turnId && !completedStatus)
        chats.finish(turnId, timedOut ? 'timeout' : interrupted ? 'interrupted' : 'error');
      release?.();
      releasePack?.();
      contextStore?.close();
      await guiBridge?.close?.().catch(() => {});
      try {
        await sessionResources?.close();
      } finally {
        fs.rmSync(configDir, { recursive: true, force: true });
      }
    }
  }
}

async function main() {
  try {
    if (process.argv[2] === 'mcp') {
      process.exitCode = await runMcp(process.argv.slice(3));
      return;
    }
    if (process.argv[2] === 'domains') {
      process.exitCode = await runDomains(process.argv.slice(3));
      return;
    }
    if (process.argv[2] === 'inspect-log') {
      inspectDiagnosticLog(process.argv.slice(3));
      return;
    }
    if (process.argv[2] === 'bench') {
      process.exitCode = await runBench(process.argv.slice(3));
      return;
    }
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
      process.stdout.write(
        (distributionDomain
          ? `This CLI package is fixed to ${distributionDomain}; --domain is optional.\n\n`
          : '') + usage,
      );
      return;
    }
    process.exitCode = await run(options);
  } catch (error) {
    emit(process.stdout, { type: 'error', message: String(error) });
    process.exitCode = 1;
  }
}

module.exports = { main, run, loadArtifacts, usage };
if (require.main === module) void main();
