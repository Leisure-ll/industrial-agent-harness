import { useEffect, useRef, useState } from 'react';
import createOcctViewer from './occt/harness-occt.js';
import type { OcctModule, OcctViewer } from './occt/harness-occt.js';
import type { CadData } from '../api';
import { useViewNavigation, useWheelZoom } from '../navigation';

export function CadViewport({
  data,
  onReady,
  onError,
}: {
  data: CadData;
  onReady: () => void;
  onError: (message: string) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [view, setView] = useState({ zoom: 1, yaw: -0.8, pitch: 0.65, x: 0, y: 0 });
  const engine = useRef<OcctViewer | null>(null);
  const [faces, setFaces] = useState(0);
  const pose = useRef(view);
  pose.current = view;
  const [ready, setReady] = useState(false);
  const drag = useRef<{ x: number; y: number; pan: boolean } | null>(null);
  const callbacks = useRef({ onReady, onError });
  callbacks.current = { onReady, onError };
  const zoom = (factor: number) =>
    setView(v => ({ ...v, zoom: Math.max(0.1, Math.min(20, v.zoom * factor)) }));
  const fit = () => {
    engine.current?.fit();
    setView({ zoom: 1, yaw: -0.8, pitch: 0.65, x: 0, y: 0 });
  };
  useWheelZoom(host, ready ? zoom : undefined);
  useViewNavigation({
    zoomIn: () => zoom(1.25),
    zoomOut: () => zoom(0.8),
    fit,
    ready,
    percent: Math.round(view.zoom * 100),
  });
  useEffect(() => {
    const element = canvas.current,
      container = host.current;
    if (!element || !container) return;
    let cancelled = false,
      instance: OcctViewer | undefined,
      module: OcctModule | undefined;
    setReady(false);
    const size = () => {
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      element.width = Math.max(1, Math.round(container.clientWidth * ratio));
      element.height = Math.max(1, Math.round(container.clientHeight * ratio));
      instance?.resize();
      const v = pose.current;
      instance?.pose(v.yaw, v.pitch, v.zoom, Math.round(v.x * ratio), Math.round(v.y * ratio));
    };
    size();
    const observer = new ResizeObserver(size);
    observer.observe(container);
    void (async () => {
      try {
        module = await createOcctViewer({
          canvas: element,
          locateFile: () => new URL('./occt/harness-occt.wasm', import.meta.url).href,
          printErr: message => console.warn('OCCT Viewer:', message),
        });
        if (cancelled) return;
        instance = new module.Viewer('#' + element.id);
        let count;
        if (data.brep) {
          const decoded = atob(data.brep);
          const bytes = Uint8Array.from(decoded, c => c.charCodeAt(0));
          module.FS.writeFile('/model.brep', bytes);
          try {
            count = instance.load('/model.brep');
          } finally {
            module.FS.unlink('/model.brep');
          }
        } else count = instance.loadMesh(data.vertices);
        if (cancelled) {
          instance.dispose();
          instance.delete();
          return;
        }
        engine.current = instance;
        setFaces(count);
        element.dataset.engine = 'OCCT 7.9.2 AIS/V3d WebGL2';
        element.dataset.renderedTriangles = String(data.triangles);
        element.dataset.renderedFaces = String(count);
        element.dataset.geometry = data.brep ? 'brep' : 'mesh';
        size();
        setReady(true);
        callbacks.current.onReady();
      } catch (error) {
        if (!cancelled) {
          setReady(false);
          callbacks.current.onError('OCCT Viewer failed: ' + String(error));
        }
      }
    })();
    return () => {
      cancelled = true;
      observer.disconnect();
      engine.current = null;
      try {
        instance?.dispose();
        instance?.delete();
      } catch {
        /* A lost WebGL context already released its resources. */
      }
      if (instance) element.getContext('webgl2')?.getExtension('WEBGL_lose_context')?.loseContext();
    };
  }, [data]);
  useEffect(() => {
    if (!ready) return;
    const frame = requestAnimationFrame(() => {
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      try {
        engine.current?.pose(
          view.yaw,
          view.pitch,
          view.zoom,
          Math.round(view.x * ratio),
          Math.round(view.y * ratio),
        );
      } catch (error) {
        setReady(false);
        callbacks.current.onError('OCCT camera failed: ' + String(error));
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [view, ready]);
  return (
    <div
      className="rp-cad"
      data-zoom={view.zoom}
      data-yaw={view.yaw}
      data-pan-x={view.x}
      data-pan-y={view.y}
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--ia-bg, #10181e)',
        color: 'var(--ia-text, #e6edf2)',
      }}
    >
      <div style={{ padding: '8px 12px', display: 'flex', gap: 16 }}>
        <strong>{data.name}</strong>
        <span>
          OCCT · {data.brep ? `${faces} faces` : `${data.triangles.toLocaleString()} triangles`}
        </span>
        <span>Drag to rotate · Shift/right drag to pan</span>
      </div>
      <div
        ref={host}
        className="rp-cad-viewport"
        style={{ flex: 1, minHeight: 160, position: 'relative', touchAction: 'none' }}
        onContextMenu={e => e.preventDefault()}
        onPointerDown={e => {
          drag.current = { x: e.clientX, y: e.clientY, pan: e.shiftKey || e.button === 2 };
          try {
            e.currentTarget.setPointerCapture(e.pointerId);
          } catch {
            /* Synthetic navigation probes have no native pointer. */
          }
        }}
        onPointerMove={e => {
          const d = drag.current;
          if (!d || !ready) return;
          const dx = e.clientX - d.x,
            dy = e.clientY - d.y;
          drag.current = { ...d, x: e.clientX, y: e.clientY };
          setView(v =>
            d.pan
              ? { ...v, x: v.x + dx, y: v.y + dy }
              : {
                  ...v,
                  yaw: v.yaw + dx * 0.008,
                  pitch: Math.max(-1.4, Math.min(1.4, v.pitch + dy * 0.008)),
                },
          );
        }}
        onPointerUp={() => {
          drag.current = null;
        }}
        onPointerCancel={() => {
          drag.current = null;
        }}
      >
        <canvas
          ref={canvas}
          id="harness-occt-canvas"
          aria-label="OCCT CAD solid"
          style={{ width: '100%', height: '100%', display: 'block' }}
        />
      </div>
      <small style={{ padding: '6px 12px' }}>
        Read-only 3D preview · Shaded surfaces and CAD edges
      </small>
    </div>
  );
}
