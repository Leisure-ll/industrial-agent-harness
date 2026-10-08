// Test-only driver for the real Electron renderer/preload/UI. No industrial execution lives here.
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const {spawn} = require('node:child_process');
const {createRequire} = require('node:module');
const delay = ms => new Promise(resolve=>setTimeout(resolve,ms));
async function startDesktop({root,entry,environment}) {
 const electron = environment.HARNESS_PROFESSIONAL_ELECTRON_CMD || createRequire(path.resolve(__dirname,'../../../apps/desktop/package.json'))('electron');
 const server=net.createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port;await new Promise(resolve=>server.close(resolve));
 const profile=path.join(root,'profile');fs.mkdirSync(profile,{recursive:true});
 const bootstrap=path.join(root,'bootstrap.cjs');
 fs.writeFileSync(bootstrap,`const {app}=require('electron'); app.setPath('userData',${JSON.stringify(profile)}); require(${JSON.stringify(entry)});`);
 const child=spawn(electron,[bootstrap,'--professional-runtime-selftest','--remote-debugging-port='+port],{cwd:root,env:environment,stdio:['ignore','pipe','pipe']});
 const log=fs.createWriteStream(path.join(root,'desktop.log'));child.stdout.pipe(log);child.stderr.pipe(log);
 let socket,sequence=0;const pending=new Map();
 async function close(){socket?.close();if(child.exitCode===null){child.kill('SIGTERM');const end=Date.now()+10000;while(child.exitCode===null&&Date.now()<end)await delay(100);if(child.exitCode===null)child.kill('SIGKILL');}log.end();}
 try {
  let target;const end=Date.now()+60000;
  while(Date.now()<end){if(child.exitCode!==null)throw Error('Desktop exited during startup; see desktop.log.');try{target=(await(await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t=>t.type==='page');if(target)break;}catch{}await delay(100);}
  if(!target)throw Error('Desktop renderer did not start.');
  socket=new WebSocket(target.webSocketDebuggerUrl);await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
  socket.addEventListener('message',event=>{const reply=JSON.parse(event.data),call=pending.get(reply.id);if(!call)return;pending.delete(reply.id);clearTimeout(call.timer);reply.error?call.reject(Error(JSON.stringify(reply.error))):call.resolve(reply.result);});
  const rejectPending=reason=>{for(const call of pending.values()){clearTimeout(call.timer);call.reject(Error(reason));}pending.clear();};
  child.once('exit',(code,signal)=>rejectPending(`Desktop exited: code=${code}, signal=${signal}; see desktop.log.`));
  socket.addEventListener('close',()=>rejectPending('Desktop debugging connection closed; see desktop.log.'));
  function send(method,params={}){return new Promise((resolve,reject)=>{if(child.exitCode!==null)return reject(Error('Desktop exited; see desktop.log.'));const id=++sequence,timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP request timed out: '+method));},30000);pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params}));});}
  async function evaluate(expression){try{const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true,userGesture:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;}catch(error){throw Error('Desktop evaluation failed: '+expression,{cause:error});}}
  async function wait(expression,timeout=30000){const end=Date.now()+timeout;while(Date.now()<end){try{const value=await evaluate(expression);if(value)return value;}catch(error){if(child.exitCode!==null)throw error;}await delay(100);}throw Error('UI timed out: '+expression+'\n'+await evaluate('document.body.innerText.slice(-4000)'));}
  // Preload exposes viewerHost before the initial loadURL promise settles. Reloading
  // then aborts that navigation and exits the real app; wait for the rendered page.
  await wait("location.href === 'app://viewer/index.html' && document.readyState === 'complete' && Boolean(window.viewerHost && document.querySelector('.ia-app'))",60000);
  return {evaluate,wait,send,close,async screenshot(file){const r=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(file,Buffer.from(r.data,'base64'));}};
 }catch(error){await close();throw error;}
}
module.exports={startDesktop};
