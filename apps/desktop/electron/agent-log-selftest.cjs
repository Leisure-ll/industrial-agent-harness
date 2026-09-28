const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const {createDiagnosticLog} = require('../../../packages/agent-kimi/src/diagnostic-log.cjs');
const {saveBindings} = require('./project-bindings.cjs');
let evidence, historicalTrace;
function prepare(config,directory) {
  evidence=path.dirname(config);
  const folder=path.join(config,'log-project');fs.mkdirSync(folder,{recursive:true});const project=fs.realpathSync(folder);
  const other=path.join(config,'other-project');fs.mkdirSync(other);
  saveBindings(config,{activeId:'log-test',projects:[{id:'log-test',name:'Agent log test',path:project,domain:'chip'},{id:'other-test',name:'Other project',path:other,domain:'chip'}]});
  const log=createDiagnosticLog(project,{directory,apiKey:'test-secret'});historicalTrace=log.traceId;
  log.record('run.start',{projectDir:project,model:{model:'Diagnostic test'}});
  log.record('prompt',{text:'User task: inspect signals'});
  log.record('sdk.event',{type:'ToolCall',payload:{id:'call-small',function:{name:'read_file',arguments:'{"path":"signals.json","note":"<script>window.logInjected=true</script>"}'}}});
  log.record('sdk.event',{type:'ToolResult',payload:{tool_call_id:'call-small',return_value:{output:'full detail\n'.repeat(1500)+'END-OF-FULL-RESULT',is_error:false,message:'test-secret'}}});
  log.record('sdk.event',{type:'ToolResult',payload:{tool_call_id:'call-large',return_value:{output:'工具细节🙂\n'.repeat(10000)+'END-OF-LARGE-RESULT',is_error:false}}});
  log.record('sdk.event',{type:'StatusUpdate',payload:{context_usage:.84,token_usage:{output:230}}});
  log.record('sdk.event',{type:'CompactionBegin',payload:{reason:'context pressure'}});
  log.record('sdk.event',{type:'CompactionEnd',payload:{}});
  log.record('sdk.event',{type:'ApprovalRequest',payload:{id:'approval-1',action:'write',description:'Example approval'}});
  log.record('approval.response',{id:'approval-1',response:'reject'});
  for(let i=0;i<115;i++)log.record('sdk.event',{type:'ContentPart',payload:{type:'think',think:`Thinking ${i}`}});
  log.record('run.end',{status:'completed',metrics:{peakContextUsage:.84,compactions:1,toolResults:2}});log.close();
  const foreign=createDiagnosticLog(other,{directory});foreign.record('run.start',{});foreign.record('prompt',{text:'OTHER-PROJECT-PRIVATE'});foreign.close();
}
// Deterministic SDK seam; production KimiSession still writes the run and emits UI events.
function createSession() {
  return {sessionId:'log-selftest-session',close:async()=>{},prompt(){
    return {result:Promise.resolve({status:'completed'}),approve:async()=>{},cancel:async()=>{},async *[Symbol.asyncIterator](){
      yield {type:'StatusUpdate',payload:{context_usage:.65,token_usage:{output:10}}};
      await new Promise(resolve=>setTimeout(resolve,3500));
      yield {type:'CompactionBegin',payload:{}};
      await new Promise(resolve=>setTimeout(resolve,1200));
      yield {type:'CompactionEnd',payload:{}};
      yield {type:'ToolCall',payload:{id:'live-call',function:{name:'read_file',arguments:'{"path":"README.md"}'}}};
      yield {type:'ToolResult',payload:{tool_call_id:'live-call',return_value:{output:'LIVE-FULL-RESULT',message:'Read complete',is_error:false}}};
    }};
  }};
}
async function run(window) {
  const evaluate=script=>window.webContents.executeJavaScript(script,true);
  async function wait(script) {
    const deadline=Date.now()+20000;
    while(Date.now()<deadline){if(await evaluate(script))return;await new Promise(resolve=>setTimeout(resolve,100));}
    throw Error(`Agent log UI timed out: ${script}`);
  }
  const selectType = async value=>{await evaluate(`(() => {const select=document.querySelector('select[aria-label="Agent log event type"]');select.value='${value}';select.dispatchEvent(new Event('change',{bubbles:true}));})()`);await new Promise(resolve=>setTimeout(resolve,350));};
  const choose = async name=>{await wait(`Array.from(document.querySelectorAll('.ia-log-records button')).some(button=>!button.disabled&&button.innerText.includes('${name}'))`);await evaluate(`Array.from(document.querySelectorAll('.ia-log-records button')).find(button=>button.innerText.includes('${name}')).click()`);};
  const requests=[];
  window.webContents.session.webRequest.onBeforeRequest((details,callback)=>{requests.push(details.url);callback({cancel:/^https?:/.test(details.url)});});
  try {
    await wait(`document.querySelector('.ia-chat-header b')?.innerText==='Agent log test'`);
    await evaluate(`document.querySelector('button[aria-label="View agent logs"]').click()`);
    await wait(`document.querySelector('.ia-log-run-info')?.innerText.includes('84%')`);
    assert.equal(await evaluate(`document.querySelectorAll('.ia-log-runs>button').length`),1,'history is project scoped');
    assert.equal(await evaluate(`window.viewerHost.diagnosticRuns({projectId:'other-test'}).then(()=>false,()=>true)`),true,'wrong project rejected over IPC');
    await selectType('context');await choose('CompactionBegin');
    await wait(`document.querySelector('.ia-log-raw')?.innerText.includes('context pressure')`);
    assert.ok(await evaluate(`document.querySelector('.ia-log-records')?.innerText.includes('CompactionEnd')`));
    await selectType('tools');await choose('ToolCall');
    await wait(`document.querySelector('.ia-log-tool-content')?.innerText.includes('signals.json')`);
    assert.equal(await evaluate(`Boolean(window.logInjected)`),false,'logged markup is text');
    await choose('call-small');
    await wait(`document.querySelector('.ia-log-tool-content')?.innerText.includes('END-OF-FULL-RESULT')`);
    assert.ok(!await evaluate(`document.querySelector('.ia-log-detail').innerText.includes('test-secret')`));
    await choose('call-large');
    await wait(`Array.from(document.querySelectorAll('.ia-log-detail button')).some(button=>button.innerText==='Next part'&&!button.disabled)`);
    let parts=0;
    while(!await evaluate(`document.querySelector('.ia-log-raw')?.innerText.includes('END-OF-LARGE-RESULT')`)) {
      assert.ok(++parts<8,'bounded payload parts');
      await evaluate(`Array.from(document.querySelectorAll('.ia-log-detail button')).find(button=>button.innerText==='Next part').click()`);
      await new Promise(resolve=>setTimeout(resolve,150));
    }
    await evaluate(`Array.from(document.querySelectorAll('.ia-log-detail button')).find(button=>button.innerText==='Previous part').click()`);
    await wait(`document.querySelector('.ia-log-detail>small')?.innerText.includes('Bytes')`);
    await selectType('all');
    await evaluate(`Array.from(document.querySelectorAll('.ia-log-events>footer button')).find(button=>button.innerText==='Next').click()`);
    await wait(`document.querySelector('.ia-log-records button b')?.innerText.startsWith('#101 ')`);
    await evaluate(`Array.from(document.querySelectorAll('.ia-log-events>footer button')).find(button=>button.innerText==='Previous').click()`);
    await wait(`document.querySelector('.ia-log-records button b')?.innerText.startsWith('#1 ')`);
    fs.writeFileSync(path.join(evidence,'agent-log-history.png'),(await window.webContents.capturePage()).toPNG());
    // Native input closes the accessible modal and returns focus to its opener.
    window.webContents.sendInputEvent({type:'keyDown',keyCode:'Escape'});window.webContents.sendInputEvent({type:'keyUp',keyCode:'Escape'});
    await wait(`!document.querySelector('.ia-agent-log')`);
    await evaluate(`(() => {const area=document.querySelector('.ia-composer textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(area,'Inspect netlist signals');area.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('.ia-chat-actions button[aria-label="View agent logs"]').focus();document.querySelector('.ia-send').click();})()`);
    await wait(`Boolean(document.querySelector('.ia-agent-flow .ia-log-link'))`);
    await evaluate(`document.querySelector('.ia-agent-flow .ia-log-link').click()`);
    await wait(`document.querySelector('.ia-log-runs>button.selected')?.innerText.includes('Running')`);
    await selectType('context');
    await wait(`document.querySelector('.ia-log-records')?.innerText.includes('CompactionBegin')`);
    await wait(`document.querySelector('.ia-log-records')?.innerText.includes('CompactionEnd')`);
    await selectType('tools');await choose('ToolResult');
    await wait(`document.querySelector('.ia-log-tool-content')?.innerText==='LIVE-FULL-RESULT'`);
    fs.writeFileSync(path.join(evidence,'agent-log-live.png'),(await window.webContents.capturePage()).toPNG());
    assert.ok(!requests.some(url=>/^https?:/.test(url)));
    console.log(JSON.stringify({ok:true,history:true,toolPayload:true,payloadParts:parts,compaction:true,liveUpdates:true,projectBoundary:true,externalRequests:0,evidence}));
  } catch(error){fs.writeFileSync(path.join(evidence,'agent-log-failure.png'),(await window.webContents.capturePage()).toPNG());console.error('Agent log UI evidence:',evidence);throw error;}
  finally {window.webContents.session.webRequest.onBeforeRequest(null);}
}
module.exports={prepare,run,createSession};
