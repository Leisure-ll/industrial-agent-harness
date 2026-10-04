import { useEffect, useRef, useState } from 'react';
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
  const [view, setView] = useState({ zoom: 1, yaw: 0.65, pitch: -0.55, x: 0, y: 0 });
  const [ready, setReady] = useState(false);
  const drag = useRef<{ x: number; y: number; pan: boolean } | null>(null);
  const callbacks = useRef({ onReady, onError });
  callbacks.current = { onReady, onError };
  const zoom = (factor: number) =>
    setView(v => ({ ...v, zoom: Math.max(0.1, Math.min(20, v.zoom * factor)) }));
  const fit = () => setView({ zoom: 1, yaw: 0.65, pitch: -0.55, x: 0, y: 0 });
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
    const draw = () => {
      try {
        const width = container.clientWidth,
          height = container.clientHeight;
        if (!width || !height) return;
        const ratio = Math.min(window.devicePixelRatio || 1, 2);
        element.width = width * ratio;
        element.height = height * ratio;
        const ctx = element.getContext('2d');
        if (!ctx) throw Error('CAD canvas is unavailable.');
        ctx.scale(ratio, ratio);
        ctx.clearRect(0, 0, width, height);
        const centre = data.bounds.slice(0, 3).map((v, i) => (v + data.bounds[i + 3]) / 2);
        const diameter = Math.hypot(...centre.map((_, i) => data.bounds[i + 3] - data.bounds[i]));
        const scale = ((Math.min(width, height) * 0.72) / diameter) * view.zoom;
        const cy = Math.cos(view.yaw),
          sy = Math.sin(view.yaw),
          cp = Math.cos(view.pitch),
          sp = Math.sin(view.pitch);
        const points: Array<[number, number, number]> = [];
        for (let i = 0; i < data.vertices.length; i += 3) {
          const x = data.vertices[i] - centre[0],
            y = data.vertices[i + 1] - centre[1],
            z = data.vertices[i + 2] - centre[2];
          const a = x * cy - y * sy,
            b = x * sy + y * cy;
          points.push([a, b * cp - z * sp, b * sp + z * cp]);
        }
        const faces = [];
        for (let i = 0; i < points.length; i += 3)
          faces.push({
            p: points.slice(i, i + 3),
            depth: (points[i][2] + points[i + 1][2] + points[i + 2][2]) / 3,
          });
        faces.sort((a, b) => a.depth - b.depth);
        for (const { p } of faces) {
          const a = p[1].map((v, i) => v - p[0][i]),
            b = p[2].map((v, i) => v - p[0][i]);
          const normal = [
            a[1] * b[2] - a[2] * b[1],
            a[2] * b[0] - a[0] * b[2],
            a[0] * b[1] - a[1] * b[0],
          ];
          const shade =
            0.45 +
            0.45 *
              Math.abs(
                (normal[0] * 0.3 + normal[1] * 0.5 + normal[2] * 0.8) /
                  (Math.hypot(...normal) || 1),
              );
          ctx.fillStyle = `rgb(${Math.round(88 * shade)},${Math.round(170 * shade)},${Math.round(225 * shade)})`;
          ctx.beginPath();
          p.forEach(([x, y], i) => {
            const px = width / 2 + view.x + x * scale,
              py = height / 2 + view.y - y * scale;
            if (i) ctx.lineTo(px, py);
            else ctx.moveTo(px, py);
          });
          ctx.closePath();
          ctx.fill();
        }
        element.dataset.renderedTriangles = String(faces.length);
        setReady(true);
        callbacks.current.onReady();
      } catch (error) {
        setReady(false);
        callbacks.current.onError(String(error));
      }
    };
    const observer = new ResizeObserver(draw);
    observer.observe(container);
    draw();
    return () => observer.disconnect();
  }, [data, view]);
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
        <span>{data.triangles.toLocaleString()} triangles</span>
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
          if (!d) return;
          const dx = e.clientX - d.x,
            dy = e.clientY - d.y;
          drag.current = { ...d, x: e.clientX, y: e.clientY };
          setView(v =>
            d.pan
              ? { ...v, x: v.x + dx, y: v.y + dy }
              : { ...v, yaw: v.yaw + dx * 0.008, pitch: v.pitch + dy * 0.008 },
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
          aria-label="CAD solid mesh"
          style={{ width: '100%', height: '100%', display: 'block' }}
        />
      </div>
      <small style={{ padding: '6px 12px' }}>
        Read-only tessellated surface · Source SHA-256 {data.sha256.slice(0, 12)} · Mesh display
        does not establish mechanical verification.
      </small>
    </div>
  );
}
