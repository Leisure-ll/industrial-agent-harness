import {
  INDUSTRIAL_SCHEMA_VERSION, IndustrialActionRecordSchema, ArtifactRefSchema,
  DomainStateSchema, ToolDescriptorSchema, ObservedArtifactSchema,
  type IndustrialActionRecord, type ArtifactRef, type DomainState, type ToolDescriptor,
} from '../src/index.cjs';

const action: IndustrialActionRecord = IndustrialActionRecordSchema.parse({});
const artifact: ArtifactRef = ArtifactRefSchema.parse({});
const state: DomainState = DomainStateSchema.parse({});
const tool: ToolDescriptor = ToolDescriptorSchema.parse({});
const version: '1' = INDUSTRIAL_SCHEMA_VERSION;
const canonicalVersion: '1' = action.schemaVersion;
const toolVersion: string = action.toolVersion;
const inputHashes: Record<string, string> = artifact.inputHashes;
const metrics: Record<string, number | boolean | string> = action.verification.metrics;
const references: string[] = state.verificationIds;
const observed = ObservedArtifactSchema.parse({});
const observedStatus: 'not_run' = observed.verificationStatus;
// @ts-expect-error Future versions require an explicit new contract.
const futureVersion: '2' = tool.schemaVersion;
// @ts-expect-error File observation is not an executed industrial artifact.
const fact: ArtifactRef = observed;
void [version, canonicalVersion, toolVersion, inputHashes, metrics, references, observedStatus, futureVersion, fact];
