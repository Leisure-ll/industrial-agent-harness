const test = require('node:test');
const assert = require('node:assert/strict');
const { classify } = require('../../scripts/ci-areas.cjs');

const files = (...names) => names.map(filename => ({ filename }));

test('plain documentation keeps the structure-only gating', () => {
  for (const group of [
    ['README.md'],
    ['doc/qa-runbook.md'],
    ['LICENSE'],
    ['architecture/decision.md', 'README.zh-CN.md'],
    ['apps/desktop/DESIGN.md'],
  ]) {
    assert.deepEqual(
      classify(files(...group)),
      { docsOnly: true, sharedChanged: false },
      group.join(', '),
    );
  }
});

test('runtime skill resources are never documentation even though they end in .md', () => {
  for (const group of [
    ['packages/domain-skills/skills/project-work/SKILL.md'],
    ['packages/computer-use-bridge/skills/computer-use/SKILL.md'],
    ['packages/domain-skills/skills/project-work/SKILL.md', 'doc/notes.md'],
  ]) {
    assert.deepEqual(
      classify(files(...group)),
      { docsOnly: false, sharedChanged: true },
      group.join(', '),
    );
  }
});

test('desktop-only and shared code keep their layer gating', () => {
  assert.deepEqual(classify(files('apps/desktop/src/App.tsx')), {
    docsOnly: false,
    sharedChanged: false,
  });
  assert.deepEqual(classify(files('apps/desktop/src/App.tsx', 'README.md')), {
    docsOnly: false,
    sharedChanged: false,
  });
  assert.deepEqual(classify(files('packages/capability-broker/src/index.cjs')), {
    docsOnly: false,
    sharedChanged: true,
  });
});

test('renamed files gate on both the new and the previous path', () => {
  // A source file moved into doc/ must not become documentation.
  assert.deepEqual(
    classify([{ filename: 'doc/edit.md', previous_filename: 'packages/domain-mcp/src/edit.cjs' }]),
    { docsOnly: false, sharedChanged: true },
  );
  // Documentation renamed within documentation stays documentation.
  assert.deepEqual(classify([{ filename: 'doc/new.md', previous_filename: 'doc/old.md' }]), {
    docsOnly: true,
    sharedChanged: false,
  });
  assert.deepEqual(
    classify([
      { filename: 'apps/desktop/src/new.tsx', previous_filename: 'packages/viewer/src/old.tsx' },
    ]),
    { docsOnly: false, sharedChanged: true },
  );
});

test('an empty change set fails safe to the full net and entries are validated', () => {
  assert.deepEqual(classify([]), { docsOnly: false, sharedChanged: true });
  assert.throws(() => classify([{}]));
  assert.throws(() => classify([null]));
  assert.throws(() => classify(['README.md']));
});
