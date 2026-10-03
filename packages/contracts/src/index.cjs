const { z } = require('zod');

const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const ObservedArtifactSchema = z.object({
  id: z.string().min(1),
  kind: z.string().min(1),
  relativePath: z.string().min(1),
  sizeBytes: z.number().int().nonnegative(),
  sha256,
  source: z.literal('project-file'),
  verificationStatus: z.literal('not_run'),
});

const ObservedStateSchema = z.object({
  projectId: z.string().min(1),
  domain: z.string().min(1),
  artifacts: z.array(ObservedArtifactSchema),
  staleArtifactIds: z.array(z.string().min(1)),
});

const ContextCheckpointSchema = z.object({
  id: z.string().uuid(),
  parentId: z.string().uuid().nullable(),
  stateHash: sha256,
  createdAt: z.string().datetime(),
  state: ObservedStateSchema,
});

const VerificationResultSchema = z.object({
  status: z.enum(['not_run', 'passed', 'failed']),
  verifierId: z.string().min(1).nullable(),
  reason: z.string().min(1),
});

const ActionRecordSchema = z.object({
  id: z.string().uuid(),
  runId: z.string().uuid(),
  projectId: sha256,
  domain: z.string().min(1),
  toolId: z.string().min(1),
  inputs: z.record(z.string(), z.unknown()),
  startedAt: z.string().datetime(),
  endedAt: z.string().datetime().nullable(),
  status: z.enum(['running', 'completed', 'failed']),
  diagnostics: z.array(z.string()),
  artifactIds: z.array(z.string()),
  verification: VerificationResultSchema,
});

module.exports = {
  ObservedArtifactSchema,
  ObservedStateSchema,
  ContextCheckpointSchema,
  VerificationResultSchema,
  ActionRecordSchema,
};
