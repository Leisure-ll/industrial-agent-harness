const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const hash=content=>crypto.createHash('sha256').update(content).digest('hex');
const source='module.exports = (a, b) => a + b;\n';
const broken='module.exports = (a, b) => a - b;\n';
const checks=`const fs = require('node:fs'), path = require('node:path');
const calculate = require(path.join(process.env.HARNESS_INPUT_DIR, 'src/calculate.cjs'));
const passed = calculate(2, 3) === 5 && calculate(-2, 2) === 0;
fs.writeFileSync(path.join(process.env.HARNESS_OUTPUT_DIR, 'checks.json'), JSON.stringify({schemaVersion:'1',checks:[{name:'calculated sums',passed}]}));
if (!passed) process.exitCode = 1;
`;
function taskManifest(runtime={kind:'local'},command=process.execPath) {
  return {schemaVersion:'1',tasks:{test:{command:[command,'{input}/tests/check.cjs'],
    inputs:['src/calculate.cjs','tests/check.cjs'],outputs:[],runtime,timeoutMs:5000,
    verification:{kind:'checks-json',path:'checks.json'}}}};
}
function files(project,runtime,command) {
  return {changes:[{path:'harness.tasks.json',content:JSON.stringify(taskManifest(runtime,command)),
    expectedSha256:fs.existsSync(path.join(project,'harness.tasks.json')) ? hash(fs.readFileSync(path.join(project,'harness.tasks.json'))):null},
    {path:'src/calculate.cjs',content:source,expectedSha256:null},{path:'tests/check.cjs',content:checks,expectedSha256:null}]};
}
function modelCalls(project) {
  return body=>{
    const text=JSON.stringify(body.messages);
    const initial=text.match(/expectedStateId=([a-f0-9-]{36})/)?.[1];
    const current=[...text.matchAll(/stateId[^a-f0-9]{1,12}([a-f0-9-]{36})/g)].at(-1)?.[1] || initial;
    const report=[...text.matchAll(/artifactSet.*?id[^a-f0-9]{1,12}([a-f0-9-]{36})/g)].at(-1)?.[1] || initial;
    const action=(toolId,inputs)=>({name:'industrial_action_call',arguments:{toolId,inputsJson:JSON.stringify(inputs),expectedStateId:current}});
    return [action('project.initialize',{name:'shared project'}),
      action('project.files.read',{path:'harness.tasks.json'}),
      {name:'industrial_artifact_read',arguments:{artifactId:report}},
      action('project.files.apply',files(project)),
      action('project.task.run',{task:'test'}),
      action('project.files.apply',{changes:[{path:'src/calculate.cjs',content:broken,expectedSha256:hash(source)}]}),
      action('project.task.run',{task:'test'}),
      action('project.files.apply',{changes:[{path:'src/calculate.cjs',content:source,expectedSha256:hash(broken)}]}),
      action('project.task.run',{task:'test'})];
  };
}
module.exports={source,broken,checks,hash,files,taskManifest,modelCalls};
