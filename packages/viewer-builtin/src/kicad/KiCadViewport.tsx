import {useEffect, useRef, useState} from 'react';
import type {KiCadData} from '../api';

export function KiCadViewport({data, onReady, onError}: {data: KiCadData; onReady: () => void; onError: (message: string) => void}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const callbacks = useRef({onReady, onError});
  callbacks.current = {onReady, onError};
  const [status, setStatus] = useState('Loading KiCad document…');
  useEffect(() => {
    setStatus('Loading KiCad document…');
    let complete = false;
    const fail = (message: string) => {complete = true; clearTimeout(timer); if (frame.current) frame.current.src = 'about:blank'; setStatus(message); callbacks.current.onError(message);};
    const timer = setTimeout(() => {if (!complete) fail('KiCad Viewer timed out. Reopen the document.');}, 30000);
    const receive = (event: MessageEvent) => {
      if (complete || event.source !== frame.current?.contentWindow || event.origin !== 'app://kicad' || event.data?.channel !== 'industrial-harness-kicad-v1') return;
      if (event.data.type === 'ready') {complete = true; clearTimeout(timer); setStatus(''); callbacks.current.onReady();}
      else if (event.data.type === 'error') fail(String(event.data.error || 'KiCad Viewer failed.'));
    };
    window.addEventListener('message', receive);
    return () => {clearTimeout(timer); window.removeEventListener('message', receive);};
  }, [data.token]);
  return <div className="rp-kicad">
    <header className="rp-kicad-toolbar"><strong title={data.name}>{data.name}</strong><span>{data.document === 'board' ? 'PCB' : 'Schematic'} · Read only</span></header>
    <div className="rp-kicad-canvas"><iframe key={data.token} ref={frame} src={data.url} title="KiCad document viewer" sandbox="allow-scripts allow-same-origin"/>{status && <div className="rp-kicad-status" role="status">{status}</div>}</div>
  </div>;
}
