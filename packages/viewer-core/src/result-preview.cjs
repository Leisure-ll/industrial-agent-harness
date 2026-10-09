function createResultPreviewPolicy() {
  let active;
  const handled = new Set();
  return {
    begin(context) {
      active = { ...context };
    },
    invalidate() {
      active = undefined;
    },
    consume(event, context) {
      if (event.type !== 'results-ready' || handled.has(event.results.turnId)) return null;
      handled.add(event.results.turnId);
      if (
        !event.autoPreviewEligible ||
        !active ||
        active.chatId !== context.chatId ||
        active.projectId !== context.projectId ||
        active.focusRevision !== context.focusRevision ||
        event.results.chatId !== context.chatId ||
        event.results.turnId !== context.turnId ||
        event.results.phase !== 'settled' ||
        !['completed', 'finished'].includes(event.results.requestStatus)
      )
        return null;
      const selection = event.results.selection;
      if (selection?.historical) return null;
      const candidates = event.results.groups.filter(
        group =>
          !group.superseded &&
          !group.historical &&
          (selection ? selection.groupIds.includes(group.id) : Boolean(group.previewArtifactId)),
      );
      if (candidates.length !== 1 || candidates[0].executionStatus !== 'completed') return null;
      const group = candidates[0];
      return {
        turnId: event.results.turnId,
        groupId: group.id,
        artifactId: group.previewArtifactId || group.primaryArtifactId,
      };
    },
  };
}
module.exports = { createResultPreviewPolicy };
