const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const {
  ArtifactRefSchema,
  DomainStateSchema,
  IndustrialVerificationResultSchema,
  ToolDescriptorSchema,
  ActionRecordSchema,
  IndustrialActionRecordSchema,
} = require('../src/index.cjs');
const id = () => crypto.randomUUID();
const hash = 'a'.repeat(64);
const evidence = { artifactIds: [id()], inputHashes: { 'inputs/design.v': hash } };
const verification = {
  schemaVersion: '1',
  id: id(),
  status: 'passed',
  verifierId: 'assertions',
  reason: 'Independent assertions passed.',
  metrics: { assertionCount: 5 },
  evidence,
};

test('acceptance needs content-bound evidence and an explicit independent verifier', () => {
  assert.equal(IndustrialVerificationResultSchema.safeParse(verification).success, true);
  assert.equal(
    IndustrialVerificationResultSchema.safeParse({ ...verification, verifierId: null }).success,
    false,
  );
  assert.equal(
    IndustrialVerificationResultSchema.safeParse({
      ...verification,
      evidence: { artifactIds: [], inputHashes: {} },
    }).success,
    false,
  );
  assert.equal(
    IndustrialVerificationResultSchema.safeParse({
      ...verification,
      status: 'insufficient_evidence',
      verifierId: null,
      evidence: { artifactIds: [], inputHashes: {} },
    }).success,
    true,
  );
});

test('artifact identity rejects unsafe paths and unknown schema versions', () => {
  const artifact = {
    schemaVersion: '1',
    id: id(),
    projectId: hash,
    runId: id(),
    actionId: id(),
    kind: 'report',
    relativePath: 'reports/result.json',
    sha256: hash,
    sizeBytes: 7,
    source: 'domain-tool',
    inputHashes: evidence.inputHashes,
  };
  assert.equal(ArtifactRefSchema.safeParse(artifact).success, true);
  for (const relativePath of ['../outside', '/outside', 'C:/outside', 'a\\b', 'a//b'])
    assert.equal(ArtifactRefSchema.safeParse({ ...artifact, relativePath }).success, false);
  assert.equal(ArtifactRefSchema.safeParse({ ...artifact, schemaVersion: '2' }).success, false);
  assert.equal(
    ArtifactRefSchema.safeParse({ ...artifact, inputHashes: { '../outside': hash } }).success,
    false,
  );
});

test('verified states and mutating tools require declared verification', () => {
  const state = {
    schemaVersion: '1',
    id: id(),
    projectId: hash,
    domain: 'test',
    stage: null,
    status: 'verified',
    artifacts: [],
    inputHashes: {},
    verificationIds: [],
    createdAt: new Date().toISOString(),
  };
  assert.equal(DomainStateSchema.safeParse(state).success, false);
  assert.equal(
    DomainStateSchema.safeParse({ ...state, verificationIds: [verification.id] }).success,
    true,
  );
  const tool = {
    schemaVersion: '1',
    id: 'test.execute',
    version: '1.0.0',
    risk: 'mutating',
    verification: [],
  };
  assert.equal(ToolDescriptorSchema.safeParse(tool).success, false);
  assert.equal(
    ToolDescriptorSchema.safeParse({ ...tool, verification: ['assertions'] }).success,
    true,
  );
});

test('legacy journals remain readable without inventing missing provenance', () => {
  const action = {
    id: id(),
    runId: id(),
    projectId: hash,
    domain: 'test',
    toolId: 'test.execute',
    inputs: {},
    startedAt: new Date().toISOString(),
    endedAt: null,
    status: 'running',
    diagnostics: [],
    artifactIds: [],
    verification: {
      status: 'not_run',
      verifierId: null,
      reason: 'Historical unverified execution.',
    },
  };
  assert.deepEqual(ActionRecordSchema.parse(action), action);
  assert.equal(IndustrialActionRecordSchema.safeParse(action).success, false);
  assert.equal(
    IndustrialActionRecordSchema.safeParse({
      ...action,
      schemaVersion: '1',
      stateId: id(),
      toolVersion: '1.0.0',
      inputHashes: evidence.inputHashes,
      verification,
    }).success,
    true,
  );
});
