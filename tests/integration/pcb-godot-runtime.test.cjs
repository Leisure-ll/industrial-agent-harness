const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createProjectRuntime } = require('../../packages/harness-core/src/index.cjs');
const owner = require('@zhiman-bj/industrial-domain-packs');
const {
  runtimeFiles: { hash },
} = require('../../packages/domain-runtime/src/index.cjs');
if (process.platform !== 'darwin' || process.arch !== 'arm64')
  throw Error('Native PCB/Godot qualification requires macOS Apple Silicon; cannot skip.');
const evidence = process.env.HARNESS_PROFESSIONAL_EVIDENCE;
function fixture(t, domain) {
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(evidence || os.tmpdir(), 'native-' + domain + '-')),
  );
  const project = path.join(root, 'project');
  fs.cpSync(
    path.join(
      owner.sourceDirectory(domain + '-pack'),
      'examples',
      domain === 'godot' ? 'structural' : 'mounting-board',
    ),
    project,
    { recursive: true },
  );
  const open = () =>
    createProjectRuntime({ projectDir: project, domain, directory: path.join(root, 'state') });
  let bundle = open();
  const results = [];
  t.after(() => {
    bundle?.runtime.close();
    if (evidence)
      fs.writeFileSync(path.join(root, 'results.json'), JSON.stringify(results, null, 2));
    else fs.rmSync(root, { recursive: true, force: true });
  });
  return {
    root,
    project,
    results,
    get runtime() {
      return bundle.runtime;
    },
    restart() {
      bundle.runtime.close();
      bundle = open();
      return bundle.runtime;
    },
  };
}
async function call(f, id, inputs, extra = {}) {
  const r = f.runtime,
    state = await r.inspect();
  const out = await r.execute(
    { toolId: id, inputs, expectedStateId: state.id, ...extra.request },
    {
      approval: true,
      scope: {
        domain: r.project.domain,
        projectId: state.projectId,
        stateId: state.id,
        tools: [id],
        ...extra.scope,
      },
    },
  );
  f.results.push(out);
  return out;
}
const godotExpect = (size = [2, 3, 4], position = [1, 2, 3]) => ({
  file: 'main.tscn',
  frames: 12,
  expect: [
    { node: 'Box', property: 'mesh_size', value: size },
    { node: 'Box', property: 'position', value: position },
  ],
});
const pcbExpect = (size = [40, 30], position = [10, 10]) => ({
  file: 'board.kicad_pcb',
  expect: { bounds: [0, 0, ...size], footprints: [{ reference: 'H1', position }], maxWarnings: 2 },
});
function digest(f, name) {
  return hash(fs.readFileSync(path.join(f.project, name)));
}
function accepted(out) {
  assert.equal(out.verification.status, 'passed', JSON.stringify(out.action));
  assert.equal(out.state.status, 'verified');
}
async function files(f, changes) {
  return call(f, 'project.files.apply', {
    changes: changes.map(([name, content]) => ({
      path: name,
      content,
      expectedSha256: fs.existsSync(path.join(f.project, name)) ? digest(f, name) : null,
    })),
  });
}
function report(f, out, kind) {
  const a = out.artifacts.find(a => a.kind === kind);
  return JSON.parse(f.runtime.readArtifact(a.id).content);
}

test(
  'real Godot continuous scene edits, independent geometry, script failure/repair and restart preserve canonical evidence',
  { timeout: 120000 },
  async t => {
    const f = fixture(t, 'godot');
    const initial = await call(f, 'godot.scene.verify', godotExpect());
    accepted(initial);
    const edit = await call(f, 'godot.scene.edit', {
      file: 'main.tscn',
      expectedSha256: digest(f, 'main.tscn'),
      changes: [
        {
          section: 'resource:Box_1',
          property: 'size',
          value: { type: 'Vector3', value: [4, 5, 6] },
        },
        { section: 'node:Box', property: 'position', value: { type: 'Vector3', value: [3, 2, 1] } },
      ],
    });
    assert.equal(edit.action.status, 'completed', JSON.stringify(edit));
    assert.equal(edit.verification.status, 'not_run');
    assert.equal(edit.state.status, 'stale');
    const second = await call(f, 'godot.scene.verify', godotExpect([4, 5, 6], [3, 2, 1]));
    accepted(second);
    assert.equal(report(f, second, 'report.godot.frames').frames, 12);
    const wrong = await call(f, 'godot.scene.verify', godotExpect([9, 5, 6], [3, 2, 1]));
    assert.equal(wrong.verification.status, 'failed');
    await files(f, [['logic.gd', 'extends Node3D\nthis is invalid gdscript\n']]);
    const broken = await call(f, 'godot.scene.verify', godotExpect([4, 5, 6], [3, 2, 1]));
    assert.equal(broken.action.status, 'failed');
    assert.notEqual(broken.verification.status, 'passed');
    assert.match(broken.action.diagnostics.join('\n'), /SCRIPT ERROR|Parse Error|ERROR:/);
    await files(f, [['logic.gd', 'extends Node3D\nfunc _ready() -> void:\n    pass\n']]);
    const repaired = await call(f, 'godot.scene.verify', godotExpect([4, 5, 6], [3, 2, 1]));
    accepted(repaired);
    assert.match(fs.readFileSync(path.join(f.project, 'main.tscn'), 'utf8'), /Vector3\(4, 5, 6\)/);
    const sceneArtifact = initial.artifacts.find(a => a.kind === 'input.godot.scene');
    assert.equal(hash(f.runtime.readArtifact(sceneArtifact.id).content), sceneArtifact.sha256);
    const restored = f.restart();
    assert.equal((await restored.inspect()).id, repaired.state.id);
    assert.equal(restored.latestCheckpoint().id, repaired.checkpoint.id);
    assert.equal(
      restored.listVerifications().find(v => v.id === initial.verification.id).status,
      'passed',
    );
    await files(f, [['logic.gd', 'extends Node3D\n# changed input\n']]);
    assert.equal((await f.runtime.inspect()).status, 'stale');
    accepted(await call(f, 'godot.scene.verify', godotExpect([4, 5, 6], [3, 2, 1])));
  },
);

test(
  'real KiCad continuous rectangular outline/footprint edits, DRC failure/repair and restart preserve original boards',
  { timeout: 120000 },
  async t => {
    const f = fixture(t, 'pcb');
    const initial = await call(f, 'pcb.kicad.verify', pcbExpect());
    accepted(initial);
    const original = digest(f, 'board.kicad_pcb');
    const changed = await call(f, 'pcb.kicad.edit', {
      file: 'board.kicad_pcb',
      expectedSha256: original,
      rectangle: { origin: [0, 0], size: [50, 35] },
      moves: [{ reference: 'H1', position: [12, 12] }],
    });
    assert.equal(changed.action.status, 'completed', JSON.stringify(changed));
    assert.equal(changed.state.status, 'stale');
    assert.notEqual(digest(f, 'board.kicad_pcb'), original);
    const second = await call(f, 'pcb.kicad.verify', pcbExpect([50, 35], [12, 12]));
    accepted(second);
    assert.equal(initial.artifacts.find(a => a.kind === 'input.pcb.board').sha256, original);
    assert.equal(
      hash(
        f.runtime.readArtifact(initial.artifacts.find(a => a.kind === 'input.pcb.board').id)
          .content,
      ),
      original,
    );
    await call(f, 'pcb.kicad.edit', {
      file: 'board.kicad_pcb',
      expectedSha256: digest(f, 'board.kicad_pcb'),
      moves: [{ reference: 'H1', position: [25, 15] }],
    });
    const drc = await call(f, 'pcb.kicad.verify', pcbExpect([50, 35], [25, 15]));
    assert.equal(drc.verification.status, 'failed', JSON.stringify(drc));
    assert.ok(drc.verification.metrics.errorCount > 0 || drc.verification.metrics.warningCount > 2);
    assert.ok(
      report(f, drc, 'report.pcb.drc').violations.some(v => v.type !== 'lib_footprint_issues'),
    );
    await call(f, 'pcb.kicad.edit', {
      file: 'board.kicad_pcb',
      expectedSha256: digest(f, 'board.kicad_pcb'),
      moves: [{ reference: 'H1', position: [15, 12] }],
    });
    const repaired = await call(f, 'pcb.kicad.verify', pcbExpect([50, 35], [15, 12]));
    accepted(repaired);
    const source = fs.readFileSync(path.join(f.project, 'board.kicad_pcb'), 'utf8');
    await files(f, [['board.kicad_pcb', '(invalid board\n']]);
    const parse = await call(f, 'pcb.kicad.verify', pcbExpect([50, 35], [15, 12]));
    assert.equal(parse.action.status, 'failed');
    assert.notEqual(parse.verification.status, 'passed');
    await files(f, [['board.kicad_pcb', source]]);
    const restoredResult = await call(f, 'pcb.kicad.verify', pcbExpect([50, 35], [15, 12]));
    accepted(restoredResult);
    const restored = f.restart();
    assert.equal((await restored.inspect()).id, restoredResult.state.id);
    assert.equal(restored.latestCheckpoint().id, restoredResult.checkpoint.id);
  },
);

for (const domain of ['pcb', 'godot'])
  test(
    `real ${domain} timeout, cancellation, input changes, stale/cross-project scope and unsafe paths fail closed`,
    { timeout: 120000 },
    async t => {
      const f = fixture(t, domain),
        id = domain === 'pcb' ? 'pcb.kicad.verify' : 'godot.scene.verify',
        inputs = domain === 'pcb' ? pcbExpect() : godotExpect();
      const completed = await call(f, id, inputs);
      accepted(completed);
      const timed = await call(f, id, { ...inputs, timeoutMs: 1 });
      assert.equal(timed.action.status, 'failed');
      assert.notEqual(timed.verification.status, 'passed');
      assert.match(timed.action.diagnostics.join('\n'), /TIMEOUT/);
      const pending = call(f, id, inputs);
      const cancel = setInterval(() => f.runtime.cancel(), 10);
      let stopped;
      try {
        stopped = await pending;
      } finally {
        clearInterval(cancel);
      }
      assert.equal(stopped.action.status, 'failed');
      assert.notEqual(stopped.verification.status, 'passed');
      assert.equal(
        f.restart().listActions().at(-1).verification.status,
        stopped.verification.status,
      );
      const foreign = await call(f, id, inputs, { scope: { projectId: '0'.repeat(64) } });
      assert.equal(foreign.action.status, 'failed');
      assert.match(foreign.action.diagnostics.join('\n'), /different/);
      const denied = await call(f, id, inputs, { scope: { tools: [] } });
      assert.equal(denied.action.status, 'failed');
      assert.match(denied.action.diagnostics.join('\n'), /outside/);
      const other = await call(f, id, inputs, { request: { projectId: 'f'.repeat(64) } });
      assert.equal(other.action.status, 'failed');
      const staleState = await f.runtime.inspect();
      await files(f, [['note.txt', 'changed inputs']]);
      const stale = await f.runtime.execute(
        { toolId: id, inputs, expectedStateId: staleState.id },
        {
          approval: true,
          scope: { domain, projectId: staleState.projectId, stateId: staleState.id, tools: [id] },
        },
      );
      assert.equal(stale.action.status, 'failed');
      assert.match(stale.action.diagnostics.join('\n'), /stale/);
      f.results.push(stale);
      const changing = call(f, id, inputs);
      await new Promise(resolve => setTimeout(resolve, 100));
      fs.writeFileSync(path.join(f.project, 'external-change.txt'), 'concurrent input change');
      const invalidated = await changing;
      assert.equal(invalidated.verification.status, 'insufficient_evidence');
      const escaped = await call(f, id, {
        ...inputs,
        file: '../outside' + (domain === 'pcb' ? '.kicad_pcb' : '.tscn'),
      });
      assert.equal(escaped.action.status, 'failed');
      const linked = path.join(f.project, 'linked' + (domain === 'pcb' ? '.kicad_pcb' : '.tscn'));
      fs.symlinkSync(path.join(f.root, 'outside'), linked);
      const symlinked = await call(f, id, { ...inputs, file: path.basename(linked) });
      assert.equal(symlinked.action.status, 'failed');
      fs.unlinkSync(linked);
      const hard = path.join(f.project, 'hard' + (domain === 'pcb' ? '.kicad_pcb' : '.tscn'));
      fs.linkSync(path.join(f.project, inputs.file), hard);
      const hardlinked = await call(f, id, { ...inputs, file: path.basename(hard) });
      assert.equal(hardlinked.action.status, 'failed');
      fs.unlinkSync(hard);
      accepted(await call(f, id, inputs));
    },
  );
