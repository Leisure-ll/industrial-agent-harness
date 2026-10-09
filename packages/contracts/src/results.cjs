const { z } = require('zod');

const id = z.string().min(1).max(320);
const ids = z.array(id).max(64);
const input = z
  .object({
    relativePath: z.string().min(1).max(4096),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
// Producer-local output names only. Neither a Pack nor an Agent assigns Artifact IDs.
const ToolPresentationSchema = z
  .object({
    schemaVersion: z.literal('1'),
    inputs: z
      .array(z.object({ output: id, relativePath: input.shape.relativePath }).strict())
      .max(32)
      .default([]),
    groups: z
      .array(
        z
          .object({
            key: z.string().min(1).max(128),
            title: z.string().min(1).max(320),
            primary: id,
            preview: id.optional(),
            attachments: ids.default([]),
            companions: ids.default([]),
            supersedesInput: input.optional(),
          })
          .strict(),
      )
      .max(32)
      .default([]),
    checks: z
      .array(z.object({ input, outputs: ids }).strict())
      .max(32)
      .default([]),
  })
  .strict();
const BoundResultGroupSchema = z
  .object({
    key: z.string().min(1).max(128),
    title: z.string().min(1).max(320),
    primaryArtifactId: z.string().uuid(),
    previewArtifactId: z.string().uuid().optional(),
    attachmentArtifactIds: z.array(z.string().uuid()).max(64),
    companionArtifactIds: z.array(z.string().uuid()).max(64),
    supersedesInput: input.optional(),
  })
  .strict();
const ActionPresentationSchema = z
  .object({
    schemaVersion: z.literal('1'),
    actionId: z.string().uuid(),
    groups: z.array(BoundResultGroupSchema).max(32),
    checks: z
      .array(z.object({ input, artifactIds: z.array(z.string().uuid()).max(64) }).strict())
      .max(32),
    diagnostics: z.array(z.string()).max(40),
  })
  .strict();
const ResultGroupSchema = BoundResultGroupSchema.omit({ key: true, supersedesInput: true })
  .extend({
    schemaVersion: z.literal('1'),
    id,
    projectId: input.shape.sha256,
    chatId: z.string().uuid(),
    turnId: z.string().uuid(),
    actionId: z.string().uuid(),
    supersedes: ids,
    verificationRefs: z
      .array(z.object({ actionId: z.string().uuid(), verificationId: z.string().uuid() }).strict())
      .max(64),
  })
  .strict();
const ResultSelectionRequestSchema = z
  .object({
    groupIds: ids.min(1),
    revision: z.number().int().nonnegative(),
    historical: z.boolean().default(false),
  })
  .strict();
module.exports = {
  ToolPresentationSchema,
  ActionPresentationSchema,
  ResultGroupSchema,
  ResultSelectionRequestSchema,
};
