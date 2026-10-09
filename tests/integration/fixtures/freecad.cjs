async function call(runtime, op, inputs, policy = {}) {
  const state = await runtime.inspect();
  return runtime.execute(
    { toolId: `cad.freecad.${op}`, inputs, expectedStateId: state.id },
    {
      scope: {
        domain: 'cad',
        projectId: state.projectId,
        stateId: state.id,
        tools: [`cad.freecad.${op}`],
      },
      approval: true,
      ...policy,
    },
  );
}
const plate = {
  parameters: { L: 40, W: 20, T: 5, R: 2 },
  features: [
    { id: 'Plate', op: 'sketch_pad', profile: 'rectangle', length: 'L', width: 'W', height: 'T' },
    { id: 'Drilled', op: 'hole', base: 'Plate', radius: 'R', height: 'T', origin: [10, 10, 0] },
  ],
  result: 'Drilled',
};

module.exports = { call, plate };
