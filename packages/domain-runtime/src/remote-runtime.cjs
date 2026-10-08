const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { IndustrialRuntime } = require('./industrial.cjs');
const { createWorkspacePlugin } = require('./workspace.cjs');
const {
  DomainStateSchema,
  ToolDescriptorSchema,
  ActionRequestSchema,
  IndustrialCheckpointSchema,
  IndustrialActionRecordSchema,
  RunRecordSchema,
  IndustrialVerificationResultSchema,
  ArtifactRefSchema,
} = require('@industrial-agent-harness/contracts');
const { hash, writePrivateJson } = require('./remote-client.cjs');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const active = new Set(['queued', 'provisioning', 'running', 'collecting']);

// Remote canonical facts retain their server identities. Local workspace edits
// use the same ProjectRef, but cannot invoke a local professional toolchain.
class RemoteRuntime {
  constructor({ settings, projectDir, domain, directory, registry, onStatus = () => {} }) {
    this.settings = settings;
    this.projectDir = fs.realpathSync(projectDir);
    this.domain = domain;
    this.binding = settings.project(projectDir, domain);
    this.configuration = settings.identity();
    if (
      !this.binding.canonicalProjectId ||
      !this.binding.snapshotId ||
      this.binding.serviceIdentity !== this.configuration
    )
      throw Error(
        'Choose and confirm files in Project execution settings before running remotely.',
      );
    this.client = settings.client();
    this.registry = registry;
    this.remoteTools = [];
    this.hostOnlyEnv = [settings.configuration().credentialEnv].filter(Boolean);
    this.hostRuntimeOnly = true;
    this.onStatus = onStatus;
    this.closed = false;
    this.statusFile = path.join(
      settings.directory,
      'remote-jobs',
      hash(this.projectDir + '\0' + domain) + '.json',
    );
    const workspace = createWorkspacePlugin({
      domain,
      protectedPaths: [directory, settings.directory].filter(Boolean),
      environment: settings.environment,
    });
    workspace.tools = workspace.tools.filter(tool => tool.descriptor.id !== 'project.task.run');
    this.capabilities = workspace.capabilities.map(item => ({
      ...item,
      tools: item.tools.filter(tool => workspace.tools.some(t => t.descriptor.id === tool.id)),
    }));
    this.workspace = new IndustrialRuntime(projectDir, domain, {
      directory: path.join(directory || path.join(settings.directory, 'core'), 'remote-workspaces'),
      projectRef: { schemaVersion: '1', projectId: this.binding.canonicalProjectId, domain },
      stateProvider: workspace.stateProvider,
      tools: workspace.tools,
      verifiers: workspace.verifiers,
    });
    this.project = this.workspace.project;
  }
  current() {
    const binding = this.settings.project(this.projectDir, this.domain);
    return (
      this.settings.identity() === this.configuration &&
      binding.location === 'remote' &&
      binding.remoteProjectId === this.binding.remoteProjectId &&
      JSON.stringify(binding.files) === JSON.stringify(this.binding.files)
    );
  }
  compatibilityKey() {
    return hash(
      JSON.stringify([
        this.configuration,
        this.binding.remoteProjectId,
        this.binding.snapshotId,
        this.binding.files,
        this.inventory?.capabilitySnapshotHash,
      ]),
    );
  }
  status() {
    try {
      return JSON.parse(fs.readFileSync(this.statusFile, 'utf8'));
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw Error('Cannot read remote task status.');
    }
  }
  publish(status) {
    writePrivateJson(this.statusFile, status);
    this.onStatus(status);
  }
  assertCurrent() {
    if (this.closed || !this.current())
      throw Error('Remote project configuration changed; start a new session.');
    this.workspace.assertProjectBound();
  }
  async inspect() {
    this.assertCurrent();
    const pending = this.status();
    if (
      pending &&
      (pending.needsImport || ['submitting', 'unknown', ...active].includes(pending.status))
    ) {
      const job = pending.jobId
        ? await this.client.job(this.binding.remoteProjectId, pending.jobId)
        : await this.client.byRequest(this.binding.remoteProjectId, pending.requestId);
      if (
        job.requestId !== pending.requestId ||
        (pending.jobId && job.jobId !== pending.jobId) ||
        (job.project && job.project !== this.binding.remoteProjectId)
      )
        throw Error('Saved remote job identity changed.');
      if (active.has(job.status))
        throw Error(
          'A remote project task is still active. Check its status before starting another.',
        );
      if (job.result) await this.importResult(job.result);
      this.publish({
        ...pending,
        jobId: job.jobId,
        status: job.status,
        queuePosition: null,
        needsImport: false,
      });
    }
    this.binding = await this.settings.ensureSynced(this.projectDir, this.domain);
    const [response, inventory] = await Promise.all([
      this.client.state(this.binding.remoteProjectId),
      this.client.capabilities(this.binding.remoteProjectId),
    ]);
    const state = DomainStateSchema.parse(response.state);
    if (
      state.projectId !== this.project.projectId ||
      state.domain !== this.domain ||
      response.snapshotId !== this.binding.snapshotId
    )
      throw Error('Remote state differs from the approved project snapshot.');
    const local = this.settings.snapshot(this.projectDir, this.binding.files);
    const expected = Object.fromEntries(local.manifest.files.map(file => [file.path, file.sha256]));
    if (
      JSON.stringify(Object.entries(state.inputHashes).sort()) !==
      JSON.stringify(Object.entries(expected).sort())
    )
      throw Error('Remote state input hashes differ from approved local files.');
    if (
      inventory.domain !== this.domain ||
      !/^[a-f0-9]{64}$/.test(inventory.capabilitySnapshotHash) ||
      !Array.isArray(inventory.tools) ||
      inventory.tools.length > 128
    )
      throw Error('Invalid remote capability snapshot.');
    this.remoteTools = inventory.tools.map(tool => ToolDescriptorSchema.parse(tool));
    this.inventory = inventory;
    this.state = state;
    const described = new Set(
      this.registry.capabilities
        .filter(item => item.domain === this.domain)
        .flatMap(item => item.tools.map(tool => tool.id)),
    );
    const deferred = this.remoteTools.filter(tool => !described.has(tool.id));
    this.capabilities = [
      ...this.capabilities.filter(item => item.id === 'project.workspace'),
      ...this.registry.capabilities
        .filter(item => item.domain === this.domain)
        .map(item => ({
          ...item,
          tools: item.tools.filter(tool => this.remoteTools.some(remote => remote.id === tool.id)),
        }))
        .filter(item => item.tools.length),
      ...(deferred.length
        ? [
            {
              id: 'remote.qualified-profile',
              domain: this.domain,
              title: 'Remote domain verification',
              stages: [],
              alwaysAvailable: true,
              priority: 0,
              keywords: [],
              skills: [],
              tools: deferred.map(tool => ({
                id: tool.id,
                summary:
                  'Run the qualified remote profile against the confirmed input snapshot. Describe this tool before calling it.',
              })),
              verification: [...new Set(deferred.flatMap(tool => tool.verification))],
            },
          ]
        : []),
    ];
    this.workspace.put('state', state.id, state);
    const { checkpoints } = await this.client.checkpoints(this.binding.remoteProjectId);
    const checkpoint = checkpoints?.at(-1);
    if (checkpoint) {
      const parsed = IndustrialCheckpointSchema.parse(checkpoint);
      if (
        parsed.state.projectId !== this.project.projectId ||
        parsed.state.domain !== this.domain ||
        hash(JSON.stringify(parsed.state)) !== parsed.stateHash
      )
        throw Error('Invalid remote checkpoint.');
      this.workspace.put('checkpoint', parsed.id, parsed);
      this.checkpoint = parsed;
    }
    return state;
  }
  descriptors(scope) {
    return [...this.workspace.descriptors(), ...this.remoteTools].filter(
      tool => !scope || scope.tools.includes(tool.id),
    );
  }
  describeTool(id, scope) {
    if (!scope?.tools.includes(id)) throw Error('Tool is outside the current Broker scope.');
    const descriptor = this.remoteTools.find(tool => tool.id === id);
    return descriptor
      ? {
          descriptor,
          guide: {
            inputs: {},
            description:
              'This remote service profile accepts an empty inputs object. Inputs come only from the confirmed project snapshot.',
          },
        }
      : this.workspace.describeTool(id, scope);
  }
  async importResult(result) {
    // Canonical parsers and immutable store writes run before facts become visible.
    result = {
      ...result,
      action: IndustrialActionRecordSchema.parse(result.action),
      run: RunRecordSchema.parse(result.run),
      verification: IndustrialVerificationResultSchema.parse(result.verification),
      artifacts: result.artifacts.map(ref => ArtifactRefSchema.parse(ref)),
    };
    const state = DomainStateSchema.parse(result.state),
      checkpoint = IndustrialCheckpointSchema.parse(result.checkpoint);
    if (
      state.projectId !== this.project.projectId ||
      state.domain !== this.domain ||
      checkpoint.state.id !== state.id ||
      hash(JSON.stringify(checkpoint.state)) !== checkpoint.stateHash ||
      result.action.projectId !== this.project.projectId ||
      result.action.domain !== this.domain ||
      result.run.domain !== this.domain ||
      result.run.projectId !== this.project.projectId ||
      result.run.id !== result.action.runId ||
      result.action.stateId !== result.run.stateId ||
      result.verification.id !== result.action.verification.id ||
      JSON.stringify(result.verification) !== JSON.stringify(result.action.verification) ||
      JSON.stringify([...result.action.artifactIds].sort()) !==
        JSON.stringify(result.artifacts.map(ref => ref.id).sort()) ||
      JSON.stringify([...result.verification.evidence.artifactIds].sort()) !==
        JSON.stringify([...result.action.artifactIds].sort()) ||
      JSON.stringify(Object.entries(result.verification.evidence.inputHashes).sort()) !==
        JSON.stringify(Object.entries(result.action.inputHashes).sort()) ||
      (result.verification.status === 'passed' &&
        (result.action.status !== 'completed' ||
          !state.verificationIds.includes(result.verification.id) ||
          !this.remoteTools
            .find(tool => tool.id === result.action.toolId)
            ?.verification.includes(result.verification.verifierId))) ||
      (result.action.toolId !== this.pendingTool && this.pendingTool) ||
      result.artifacts.some(
        ref =>
          ref.projectId !== this.project.projectId ||
          ref.runId !== result.run.id ||
          ref.actionId !== result.action.id,
      )
    )
      throw Error('Remote result identity differs from this project action.');
    const objects = [];
    for (const ref of result.artifacts) {
      const artifact = await this.client.artifact(this.binding.remoteProjectId, ref.id);
      if (JSON.stringify(artifact.ref) !== JSON.stringify(ref))
        throw Error('Remote artifact metadata changed.');
      objects.push(artifact);
    }
    for (const { ref, content } of objects) {
      const file = path.join(this.workspace.blobDirectory, ref.sha256);
      if (!fs.existsSync(file)) fs.writeFileSync(file, content, { flag: 'wx', mode: 0o400 });
      else if (hash(fs.readFileSync(file)) !== ref.sha256)
        throw Error('Local remote artifact cache is corrupt.');
    }
    this.workspace.transaction(() => {
      for (const [kind, value] of [
        ['run', result.run],
        ['action', result.action],
        ['verification', result.verification],
        ['state', state],
        ['checkpoint', checkpoint],
        ...result.artifacts.map(ref => ['artifact', ref]),
      ])
        this.workspace.put(kind, value.id, value);
    });
    this.state = state;
    this.checkpoint = checkpoint;
    return result;
  }
  async execute(request, { scope, approval = false } = {}) {
    if (this.executing) throw Error('A project action is already running.');
    this.executing = true;
    this.cancelled = false;
    this.cancellation = null;
    this.activeExecution = this.executeOne(request, { scope, approval });
    try {
      return await this.activeExecution;
    } catch (error) {
      const local = await this.workspace.inspect();
      const failed = await this.workspace.execute(
        { ...request, expectedStateId: local.id },
        {
          scope: {
            projectId: this.project.projectId,
            domain: this.domain,
            stateId: local.id,
            tools: [],
          },
          approval: false,
        },
      );
      // A failed transport attempt does not claim an uncertain remote job failed.
      const verification = {
        ...failed.verification,
        id: crypto.randomUUID(),
        reason: String(error.message).slice(0, 4096),
      };
      const action = { ...failed.action, diagnostics: [verification.reason], verification };
      this.workspace.transaction(() => {
        this.workspace.put('verification', verification.id, verification);
        this.workspace.put('action', action.id, action, true);
      });
      const current = await this.inspect().catch(() => local);
      const checkpoint = this.workspace.createCheckpoint(current, failed.run, action);
      this.checkpoint = checkpoint;
      return { ...failed, action, verification, state: current, checkpoint };
    } finally {
      this.executing = false;
      this.activeExecution = null;
      this.jobId = null;
      this.pendingTool = null;
    }
  }
  async executeOne(request, policy) {
    const state = await this.inspect();
    const action = ActionRequestSchema.parse({ ...this.project, ...request });
    if (
      action.projectId !== state.projectId ||
      action.domain !== state.domain ||
      action.expectedStateId !== state.id ||
      policy.scope?.projectId !== state.projectId ||
      policy.scope?.domain !== state.domain ||
      policy.scope?.stateId !== state.id ||
      !policy.scope.tools.includes(action.toolId)
    )
      throw Error('Remote action has an invalid or stale Broker scope.');
    const descriptor = this.descriptors().find(tool => tool.id === action.toolId);
    if (!descriptor) throw Error('Remote tool is unavailable.');
    if (descriptor.risk === 'mutating' && policy.approval !== true)
      throw Error('Remote action requires approval in this chat.');
    if (!this.remoteTools.some(tool => tool.id === action.toolId)) {
      const localState = await this.workspace.inspect();
      const result = await this.workspace.execute(
        { ...action, expectedStateId: localState.id },
        { ...policy, scope: { ...policy.scope, stateId: localState.id } },
      );
      const next = await this.inspect();
      const checkpoint = this.workspace.createCheckpoint(next, result.run, result.action);
      this.checkpoint = checkpoint;
      return { ...result, state: next, checkpoint };
    }
    if (Object.keys(action.inputs).length)
      throw Error('This remote profile accepts no execution overrides.');
    const intent = {
      requestId: crypto.randomUUID(),
      snapshotId: this.binding.snapshotId,
      capabilitySnapshotHash: this.inventory.capabilitySnapshotHash,
      action,
    };
    const pending = {
      requestId: intent.requestId,
      jobId: null,
      status: 'submitting',
      queuePosition: null,
      remoteProjectId: this.binding.remoteProjectId,
      serviceIdentity: this.configuration,
    };
    this.pendingTool = action.toolId;
    this.publish(pending);
    let job;
    try {
      if (this.cancelled)
        throw Object.assign(Error('Remote task was cancelled before submission.'), {
          knownNotSubmitted: true,
        });
      job = await this.client.submit(this.binding.remoteProjectId, intent);
      this.jobId = job.jobId;
      const deadline = Date.now() + 300000;
      while (true) {
        if (
          job.requestId !== intent.requestId ||
          (job.project && job.project !== this.binding.remoteProjectId)
        )
          throw Error('Remote job identity differs from its submission.');
        this.publish({
          ...pending,
          jobId: job.jobId,
          status: job.status,
          queuePosition: job.queuePosition,
        });
        if (!active.has(job.status)) break;
        if (this.cancelled) {
          this.cancellation ||= this.client.cancel(this.binding.remoteProjectId, job.jobId);
          await this.cancellation;
        }
        if (Date.now() > deadline)
          throw Error('Remote task is still pending. Check the saved task status later.');
        await sleep(500);
        job = await this.client.job(this.binding.remoteProjectId, job.jobId);
      }
      if (!job.result) throw Error('Remote task ended without canonical results.');
      const result = await this.importResult(job.result);
      const current = await this.inspect();
      return { ...result, state: current, checkpoint: this.latestCheckpoint() };
    } catch (error) {
      this.publish({
        ...pending,
        jobId: this.jobId,
        status: job?.result
          ? 'unknown'
          : job && !active.has(job.status)
            ? job.status
            : error.knownNotSubmitted || (error.status && error.status < 500 && !this.jobId)
              ? 'failed'
              : 'unknown',
        queuePosition: null,
        needsImport: Boolean(job?.result),
      });
      throw error;
    }
  }
  cancel() {
    this.cancelled = true;
    this.workspace.cancel();
    if (this.jobId && !this.cancellation) {
      this.cancellation = this.client.cancel(this.binding.remoteProjectId, this.jobId);
      this.cancellation.catch(() => {});
    }
  }
  async waitForIdle() {
    if (this.activeExecution) await this.activeExecution;
  }
  readArtifact(id) {
    return this.workspace.readArtifact(id);
  }
  latestCheckpoint() {
    return this.checkpoint || this.workspace.latestCheckpoint();
  }
  listRuns() {
    return this.workspace.listRuns();
  }
  listActions() {
    return this.workspace.listActions();
  }
  listVerifications() {
    return this.workspace.listVerifications();
  }
  listCheckpoints() {
    return this.workspace.listCheckpoints();
  }
  close() {
    if (this.executing) throw Error('Cannot close a running remote action.');
    this.workspace.close();
    this.closed = true;
  }
}
function createRemoteRuntime(options) {
  const runtime = new RemoteRuntime(options);
  return {
    runtime,
    configurationCurrent: () => runtime.current(),
    stateDiagnostics: [],
    get capabilities() {
      return runtime.capabilities;
    },
    protectedPaths: [runtime.workspace.directory, options.settings.directory],
    packId: 'builtin-remote',
    packVersion: '0.2',
  };
}
module.exports = { RemoteRuntime, createRemoteRuntime };
