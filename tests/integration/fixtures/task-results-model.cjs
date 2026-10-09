const { startModel } = require('./domain-mcp-model.cjs');

function actionOutputs(messages) {
  const found = [];
  function visit(value, depth = 0) {
    if (depth > 12 || !value) return;
    if (typeof value === 'string') {
      try { visit(JSON.parse(value.slice(value.indexOf('{'))), depth + 1); } catch {}
    }
    else if (Array.isArray(value)) value.forEach(item => visit(item, depth + 1));
    else if (typeof value === 'object') {
      if (value.artifactSet && value.actionId) found.push(value);
      else Object.values(value).forEach(item => visit(item, depth + 1));
    }
  }
  messages.filter(message => message.role === 'tool').forEach(message => visit(message.content));
  return found;
}
async function startResultsModel() {
  return startModel({ perPrompt: true, success: 'RESULTS_NATIVE_CHAIN_COMPLETE', calls: body => {
    const outputs = actionOutputs(body.messages);
    const last = outputs.at(-1);
    const initialState = JSON.stringify(body.messages).match(/expectedStateId=([a-f0-9-]{36})/)?.[1];
    const stateId = last?.stateId || initialState;
    const source = last?.artifactSet.find(artifact => artifact.kind === 'model.cad.fcstd')?.relativePath;
    const call = (operation, inputs) => ({ name: 'industrial_action_call', arguments: { toolId: `cad.freecad.${operation}`, inputsJson: JSON.stringify(inputs), expectedStateId: stateId } });
    return [
      { name: 'industrial_tool_describe', arguments: { toolId: 'cad.freecad.build' } },
      call('build', { recipe: { parameters: { W: 20 }, features: [{ id: 'Plate', op: 'sketch_pad', profile: 'rectangle', length: 40, width: 'W', height: 5 }], result: 'Plate' }, expect: { bounds: [40, 20, 5] } }),
      call('edit', { file: source, changes: { parameters: { W: 30 } }, expect: { bounds: [40, 30, 5] } }),
      call('edit', { file: source, changes: { parameters: { W: 35 } }, expect: { bounds: [40, 35, 5] } }),
      call('inspect', { file: source, expect: { bounds: [40, 35, 5] } }),
    ];
  } });
}
module.exports = { startResultsModel, actionOutputs };
