function engineeringContext(state, artifactBudget = 2048) {
  if (!state) return '';
  const facts = {
    schemaVersion: state.schemaVersion,
    id: state.id,
    projectId: state.projectId,
    domain: state.domain,
    stage: state.stage,
    status: state.status,
    verificationIds: state.verificationIds,
    inputCount: Object.keys(state.inputHashes).length,
  };
  // Include current output references, not contents or a guessed active model.
  // This lets "the version just created" refer to the saved Runtime evidence.
  const refs = [...(state.artifacts || [])].sort(
    (a, b) => Number(b.kind.startsWith('model.')) - Number(a.kind.startsWith('model.')),
  );
  const currentArtifacts = [];
  for (const artifact of refs.slice(0, 12)) {
    const ref = {
      id: artifact.id,
      kind: artifact.kind,
      relativePath: artifact.relativePath,
      sha256: artifact.sha256,
    };
    if (Buffer.byteLength(JSON.stringify([...currentArtifacts, ref])) > artifactBudget) break;
    currentArtifacts.push(ref);
  }
  return (
    '\nPersisted DomainState (engineering facts): ' +
    JSON.stringify({ ...facts, currentArtifacts }) +
    '. These artifact references belong to the current recorded output; root inputs are separate. For a continuation, read the matching current output and its companions before editing. Use industrial_tool_describe, then industrial_action_call with expectedStateId=' +
    state.id +
    ', a Tool from the current Broker allowlist, and declared inputs (prefer inputsJson). Read returned verification and its limits; a stale state requires fresh inspection and scope resolution.'
  );
}
module.exports = { engineeringContext };
