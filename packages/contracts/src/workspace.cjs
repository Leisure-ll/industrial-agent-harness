const { z } = require('zod');
const ProjectPathSchema = z
  .string()
  .min(1)
  .max(512)
  .refine(
    value =>
      !value.includes('\\') &&
      !value.includes('\0') &&
      !value.startsWith('/') &&
      !/^[A-Za-z]:/.test(value) &&
      !value.split('/').some(part => !part || part === '.' || part === '..'),
    'Expected a project-relative POSIX path',
  );
const sha = z.string().regex(/^[a-f0-9]{64}$/);
const ProjectInitializeRequestSchema = z.object({ name: z.string().min(1).max(128) }).strict();
const ProjectFileReadRequestSchema = z.object({ path: ProjectPathSchema.optional() }).strict();
const ProjectFileApplyRequestSchema = z
  .object({
    changes: z
      .array(
        z
          .object({
            path: ProjectPathSchema,
            content: z
              .string()
              .max(262144)
              .refine(
                value => new TextEncoder().encode(value).length <= 262144,
                'File contents exceed 256 KiB UTF-8',
              )
              .nullable(),
            expectedSha256: sha.nullable(),
          })
          .strict(),
      )
      .min(1)
      .max(32),
  })
  .strict()
  .refine(
    value => new Set(value.changes.map(change => change.path)).size === value.changes.length,
    'Each path may occur once per batch',
  );
const ProjectTaskSchema = z
  .object({
    command: z
      .array(
        z
          .string()
          .min(1)
          .max(4096)
          .refine(value => !value.includes('\0')),
      )
      .min(1)
      .max(128),
    inputs: z.array(ProjectPathSchema).min(1).max(1024),
    outputs: z
      .array(
        z
          .object({
            path: ProjectPathSchema,
            kind: z
              .string()
              .min(1)
              .max(128)
              .refine(
                value => !['report.execution', 'report.task-checks', 'log.task'].includes(value),
                'Reserved runtime artifact kind',
              ),
          })
          .strict(),
      )
      .max(64)
      .default([]),
    verification: z
      .object({ kind: z.literal('checks-json'), path: ProjectPathSchema })
      .strict()
      .optional(),
    timeoutMs: z.number().int().min(100).max(3600000).default(60000),
    runtime: z
      .discriminatedUnion('kind', [
        z
          .object({
            kind: z.literal('local'),
            readOnlyDirs: z
              .array(
                z
                  .string()
                  .min(1)
                  .max(4096)
                  .refine(
                    value =>
                      !value.includes('\0') &&
                      (value.startsWith('/') || /^[A-Za-z]:[\\/]/.test(value)),
                    'Expected an absolute dependency directory',
                  ),
              )
              .max(32)
              .optional(),
          })
          .strict(),
        z
          .object({
            kind: z.literal('docker'),
            image: z
              .string()
              .min(1)
              .max(512)
              .regex(/^[a-zA-Z0-9][a-zA-Z0-9._/:@-]*$/),
            cpus: z.number().positive().max(64).default(2),
            memoryMb: z.number().int().min(64).max(65536).default(2048),
            pids: z.number().int().min(16).max(4096).default(256),
          })
          .strict(),
      ])
      .default({ kind: 'local' }),
  })
  .strict();
const ProjectTaskManifestSchema = z
  .object({
    schemaVersion: z.literal('1'),
    workspace: z
      .object({
        inputs: z.array(ProjectPathSchema).min(1).max(256).optional(),
        ignore: z.array(ProjectPathSchema).max(256).optional(),
      })
      .strict()
      .optional(),
    tasks: z.record(z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/), ProjectTaskSchema),
  })
  .strict();
const ProjectTaskRunRequestSchema = z.object({ task: z.string().min(1).max(64) }).strict();
const ProjectTaskCheckReportSchema = z
  .object({
    schemaVersion: z.literal('1'),
    checks: z
      .array(
        z
          .object({
            name: z.string().min(1).max(256),
            passed: z.boolean(),
            details: z.string().max(4096).optional(),
          })
          .strict(),
      )
      .min(1)
      .max(1024),
  })
  .strict()
  .refine(
    value => new Set(value.checks.map(check => check.name)).size === value.checks.length,
    'Check names must be unique',
  );
module.exports = {
  ProjectPathSchema,
  ProjectInitializeRequestSchema,
  ProjectFileReadRequestSchema,
  ProjectFileApplyRequestSchema,
  ProjectTaskManifestSchema,
  ProjectTaskRunRequestSchema,
  ProjectTaskCheckReportSchema,
};
