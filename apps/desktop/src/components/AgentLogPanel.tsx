import {useEffect, useRef, useState} from 'react';
import type {DiagnosticCategory, DiagnosticContent, DiagnosticPage, DiagnosticRecord, DiagnosticRun} from '@industrial-agent-harness/viewer-builtin/api';

const categories: Array<[DiagnosticCategory | 'all', string]> = [['all','All events'],['tools','Tool calls & results'],['context','Context & compaction'],['thinking','Thinking'],['approvals','Approvals'],['run','Run & session'],['ui','Chat display events']];
const stamp = (at: string) => {const value = new Date(at); return Number.isNaN(value.getTime()) ? at : value.toLocaleString();};
function readable(content: DiagnosticContent) {
  if (content.offset === 0 && content.nextOffset === null) {try {return JSON.stringify(JSON.parse(content.text),null,2);} catch {}}
  return content.text;
}
export function AgentLogPanel({projectId, projectName, initialTraceId, runningTraceId, running, onClose}: {projectId: string; projectName: string; initialTraceId?: string; runningTraceId?: string; running: boolean; onClose: () => void}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [runs,setRuns]=useState<DiagnosticRun[]>([]), [limited,setLimited]=useState(false);
  const [runId,setRunId]=useState(''), [category,setCategory]=useState<DiagnosticCategory | 'all'>('all'), [query,setQuery]=useState(''), [search,setSearch]=useState('');
  const [page,setPage]=useState<DiagnosticPage>(), [offset,setOffset]=useState(0), [selected,setSelected]=useState<DiagnosticRecord>();
  const [content,setContent]=useState<DiagnosticContent>(), [contentOffset,setContentOffset]=useState(0), [parts,setParts]=useState<number[]>([]);
  const [error,setError]=useState(''), [loading,setLoading]=useState(false), [detailLoading,setDetailLoading]=useState(false), [refresh,setRefresh]=useState(0);
  const run = runs.find(item=>item.runId===runId);
  useEffect(()=>{const node=dialog.current!;const previous=document.activeElement;node.showModal();return()=>{node.close();if(previous instanceof HTMLElement)previous.focus();};},[]);
  useEffect(()=>{const timer=setTimeout(()=>{setSearch(query.trim());setOffset(0);setSelected(undefined);setContent(undefined);},200);return()=>clearTimeout(timer);},[query]);
  useEffect(()=>{
    let cancelled=false;
    window.viewerHost!.diagnosticRuns({projectId}).then(result=>{
      if(cancelled)return;
      setRuns(result.runs);setLimited(result.limited);
      const requested=result.runs.find(item=>item.traceId===initialTraceId);
      if(initialTraceId&&!requested)setError('Requested run is not in the available log list. Select another run.');
      setRunId(current=>result.runs.some(item=>item.runId===current)?current:requested?.runId || (initialTraceId ? '' : result.runs[0]?.runId || ''));
    }).catch(reason=>{if(!cancelled)setError(String(reason));});
    return()=>{cancelled=true;};
  },[projectId,initialTraceId,refresh]);
  useEffect(()=>{
    if(!runId){setPage(undefined);return;}
    let cancelled=false;setLoading(true);setError('');
    window.viewerHost!.diagnosticPage({projectId,runId,category,query:search,offset}).then(result=>{if(!cancelled)setPage(result);}).catch(reason=>{if(!cancelled){setPage(undefined);setError(String(reason));}}).finally(()=>{if(!cancelled)setLoading(false);});
    return()=>{cancelled=true;};
  },[projectId,runId,category,search,offset,refresh]);
  useEffect(()=>{setOffset(0);setSelected(undefined);setContent(undefined);setContentOffset(0);setParts([]);},[runId]);
  useEffect(()=>{
    setContent(undefined);
    if(!selected||!runId)return;
    let cancelled=false;setDetailLoading(true);
    window.viewerHost!.diagnosticRecord({projectId,runId,sequence:selected.sequence,offset:contentOffset}).then(result=>{if(!cancelled)setContent(result);}).catch(reason=>{if(!cancelled)setError(String(reason));}).finally(()=>{if(!cancelled)setDetailLoading(false);});
    return()=>{cancelled=true;};
  },[projectId,runId,selected,contentOffset]);
  useEffect(()=>{
    setRefresh(value=>value+1);
    if(!running)return;
    const timer=setInterval(()=>setRefresh(value=>value+1),2000);
    return()=>clearInterval(timer);
  },[running]);
  function chooseRun(id: string){setPage(undefined);setRunId(id);setOffset(0);setSelected(undefined);setContent(undefined);setContentOffset(0);setParts([]);setError('');}
  function chooseRecord(row: DiagnosticRecord){setContent(undefined);setSelected(row);setContentOffset(0);setParts([]);}
  const raw = content ? readable(content) : '';
  let tool: {input?: string; output?: string} | null = null;
  if(content?.offset===0&&content.nextOffset===null){try {
    const record=JSON.parse(content.text), event=record.payload;
    if(record.type==='sdk.event'&&event?.type==='ToolCall')tool={input:typeof event.payload?.function?.arguments==='string'?event.payload.function.arguments:JSON.stringify(event.payload?.function?.arguments ?? {},null,2)};
    if(record.type==='sdk.event'&&event?.type==='ToolResult')tool={output:typeof event.payload?.return_value?.output==='string'?event.payload.return_value.output:JSON.stringify(event.payload?.return_value ?? {},null,2)};
  } catch {}}
  return <dialog ref={dialog} className="ia-agent-log" aria-labelledby="ia-log-title" onCancel={event=>{event.preventDefault();onClose();}}>
    <header><div><h2 id="ia-log-title">Agent logs</h2><span>{projectName} · Recorded agent behavior</span></div><button aria-label="Close agent logs" onClick={onClose}>×</button></header>
    <div className="ia-log-body">
      <aside className="ia-log-runs"><div className="ia-log-section-title"><b>Runs</b><button onClick={()=>setRefresh(value=>value+1)} aria-label="Refresh agent logs">Refresh</button></div>
        {!runs.length&&<p>No agent logs yet. Run a task in this project to record tool calls, context usage and compaction.</p>}
        {runs.map(item=><button key={item.runId} className={runId===item.runId?'selected':''} onClick={()=>chooseRun(item.runId)} title={item.traceId}><time>{stamp(item.at)}</time><b>{item.model || 'Agent run'}</b><small>{item.traceId.slice(0,8)} · {item.traceId===runningTraceId&&running?'Running':item.status || 'No end record'}</small>{item.error&&<small>{item.error}</small>}</button>)}
        {limited&&<p>Showing up to 50 recent runs.</p>}
      </aside>
      <section className="ia-log-events"><div className="ia-log-filters"><label>Event type<select aria-label="Agent log event type" value={category} onChange={event=>{setCategory(event.target.value as DiagnosticCategory|'all');setOffset(0);setSelected(undefined);setContent(undefined);}}>{categories.map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label><label>Find event<input aria-label="Find agent log event" placeholder="Event name, tool or summary" value={query} onChange={event=>setQuery(event.target.value)}/></label></div>
        {run&&<div className="ia-log-run-info"><code title={run.traceId}>Trace {run.traceId}</code>{run.metrics&&<span>Peak context {run.metrics.peakContextUsage==null?'—':`${Math.round(run.metrics.peakContextUsage*100)}%`} · {run.metrics.compactions} compactions · {run.metrics.toolResults} tool results</span>}<small>{run.sizeBytes==null?'':`${run.sizeBytes.toLocaleString()} bytes`} · {page?.totalRecords ?? '—'} records</small></div>}
        {error&&<p className="ia-log-error" role="alert">{error}</p>}
        <div className="ia-log-records" aria-busy={loading}>{loading&&!page&&<p>Loading events…</p>}{page?.records.map(row=><button key={`${runId}:${row.sequence}`} disabled={loading} className={selected?.sequence===row.sequence?'selected':''} onClick={()=>chooseRecord(row)}><span><b>#{row.sequence} {row.event || row.type}</b><small>{row.type==='sdk.event'?'SDK':row.type==='harness.event'?'UI':'Harness'} · {stamp(row.at)}</small></span>{row.summary&&<p>{row.summary}</p>}</button>)}{page&&!page.records.length&&<p>{page.totalRecords?'No matching events.':'Waiting for the first complete record…'}</p>}</div>
        <footer><span>{page?`${page.total} matching events`:''}{page?.pending?' · A record is still being written':''}</span><button disabled={!offset||loading} onClick={()=>{setOffset(value=>Math.max(0,value-100));setSelected(undefined);setContent(undefined);}}>Previous</button><button disabled={page?.nextOffset==null||loading} onClick={()=>{setOffset(page!.nextOffset!);setSelected(undefined);setContent(undefined);}}>Next</button></footer>
      </section>
      <section className="ia-log-detail" aria-busy={detailLoading}><div className="ia-log-section-title"><b>{selected?`Event #${selected.sequence} · ${selected.event || selected.type}`:'Event detail'}</b></div>
        {!selected&&<p>Select an event to see the recorded parameters, result or context details.</p>}{detailLoading&&<p>Loading recorded content…</p>}
        {content&&<><small>{content.totalBytes.toLocaleString()} bytes · {content.offset===0&&content.nextOffset===null?'Complete record':`Bytes ${content.offset+1}–${content.nextOffset ?? content.totalBytes}`}</small>
          {tool&&<><h3>{tool.input!=null?'Tool input':'Tool result'}</h3><pre className="ia-log-tool-content">{tool.input ?? tool.output}</pre></>}
          <details open={!tool}><summary>Original event JSON</summary><pre className="ia-log-raw">{raw}</pre></details>
          {(content.offset>0||content.nextOffset!=null)&&<footer><span>Large records are available in full across parts.</span><button disabled={!parts.length} onClick={()=>{setContentOffset(parts.at(-1)!);setParts(value=>value.slice(0,-1));}}>Previous part</button><button disabled={content.nextOffset==null} onClick={()=>{setParts(value=>[...value,contentOffset]);setContentOffset(content.nextOffset!);}}>Next part</button></footer>}
        </>}
      </section>
    </div>
    <footer className="ia-log-note">Read-only diagnostic records · Refreshes while the agent runs · Escape to close</footer>
  </dialog>;
}
