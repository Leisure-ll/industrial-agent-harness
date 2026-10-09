import type { TaskResultView } from '@industrial-agent-harness/viewer-builtin/api';

export function partitionResultGroups(groups: TaskResultView['groups']) {
  // Use explicit artifact membership, never titles, extensions or domain IDs.
  const attachments = new Set(
    groups.flatMap(group =>
      group.artifacts
        .filter(artifact => artifact.id !== group.primaryArtifactId)
        .map(artifact => artifact.id),
    ),
  );
  const current = groups.filter(group => !group.superseded || group.selected);
  const supporting = current.filter(
    group =>
      !group.previewArtifactId &&
      !group.selected &&
      group.executionStatus === 'completed' &&
      group.contentStatus === 'recorded' &&
      group.verifications.every(check => ['passed', 'not_run'].includes(check.status)) &&
      attachments.has(group.primaryArtifactId),
  );
  if (supporting.length === current.length) supporting.length = 0;
  const supportingIds = new Set(supporting.map(group => group.id));
  return {
    main: current.filter(group => !supportingIds.has(group.id)),
    supporting,
    previous: groups.filter(group => group.superseded && !group.selected),
  };
}
