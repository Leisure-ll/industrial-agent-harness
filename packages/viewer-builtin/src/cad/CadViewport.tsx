import { useEffect, useId, useRef, useState } from 'react';
import createOcctViewer from './occt/harness-occt.js';
import type { OcctModule, OcctViewer } from './occt/harness-occt.js';
import type { CadData } from '../api';
import { useViewNavigation, useWheelZoom } from '../navigation';
import { SketchViewport } from './SketchViewport';
import type { SketchView } from './SketchViewport';
import './cad.css';
type Measurement = {
  items: Array<{
    kind: 'edge' | 'face';
    index: number;
    length?: number;
    area?: number;
    radius?: number;
    center: number[];
  }>;
  distance?: number;
  points?: number[][];
};
const initialView = { zoom: 1, yaw: -0.8, pitch: 0.65, x: 0, y: 0 };
const number = (v: number) =>
  Number(v.toFixed(4)).toLocaleString('en', { maximumFractionDigits: 4 });
const ratio = () => Math.min(window.devicePixelRatio || 1, 2);
export function CadViewport({
  data,
  onReady,
  onError,
}: {
  data: CadData;
  onReady: () => void;
  onError: (message: string) => void;
}) {
  const host = useRef<HTMLDivElement>(null),
    canvas = useRef<HTMLCanvasElement>(null);
  const canvasId = 'harness-occt-' + useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const [view, setView] = useState(initialView),
    [tab, setTab] = useState<'model' | 'sketch'>('model');
  const [sketchView, setSketchView] = useState<SketchView>({ zoom: 1, x: 0, y: 0 });
  const engine = useRef<OcctViewer | null>(null),
    pose = useRef(view);
  pose.current = view;
  const [faces, setFaces] = useState(0),
    [ready, setReady] = useState(false),
    [mode, setMode] = useState(0);
  const [measurement, setMeasurement] = useState<Measurement>({ items: [] });
  const [projected, setProjected] = useState<number[][]>([]),
    [size, setSize] = useState({ width: 1, height: 1 });
  const [section, setSection] = useState({ enabled: false, axis: 0, position: 50, flip: false });
  const [interactionError, setInteractionError] = useState('');
  const drag = useRef<{ x: number; y: number; pan: boolean; moved: number } | null>(null);
  const hoverFrame = useRef<number | null>(null);
  const callbacks = useRef({ onReady, onError });
  callbacks.current = { onReady, onError };
  const zoom = (factor: number) =>
    setView(v => ({ ...v, zoom: Math.max(0.1, Math.min(20, v.zoom * factor)) }));
  const sketchZoom = (factor: number) =>
    setSketchView(v => ({ ...v, zoom: Math.max(0.1, Math.min(20, v.zoom * factor)) }));
  const run = (fn: (viewer: OcctViewer) => void) => {
    if (!engine.current || !ready) return;
    try {
      fn(engine.current);
      setInteractionError('');
    } catch (error) {
      setInteractionError('操作未完成：' + String(error));
    }
  };
  const fit = () => {
    if (tab === 'sketch') setSketchView({ zoom: 1, x: 0, y: 0 });
    else
      run(viewer => {
        viewer.fit();
        setView(initialView);
      });
  };
  useWheelZoom(host, ready && tab === 'model' ? zoom : undefined);
  useViewNavigation({
    zoomIn: () => (tab === 'model' ? zoom : sketchZoom)(1.25),
    zoomOut: () => (tab === 'model' ? zoom : sketchZoom)(0.8),
    fit,
    ready: tab === 'model' ? ready : Boolean(data.sketches?.length),
    percent: Math.round((tab === 'model' ? view.zoom : sketchView.zoom) * 100),
  });
  useEffect(() => {
    const element = canvas.current,
      container = host.current;
    if (!element || !container) return;
    let cancelled = false,
      instance: OcctViewer | undefined,
      module: OcctModule | undefined;
    setReady(false);
    const resize = () => {
      if (!container.clientWidth || !container.clientHeight) return;
      const r = ratio();
      element.width = Math.max(1, Math.round(container.clientWidth * r));
      element.height = Math.max(1, Math.round(container.clientHeight * r));
      setSize({ width: container.clientWidth, height: container.clientHeight });
      if (instance)
        try {
          instance.resize();
          const v = pose.current;
          instance.pose(v.yaw, v.pitch, v.zoom, Math.round(v.x * r), Math.round(v.y * r));
        } catch (error) {
          if (!cancelled) {
            setReady(false);
            callbacks.current.onError('OCCT resize failed: ' + String(error));
          }
        }
    };
    resize();
    const observer = new ResizeObserver(resize);
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
          module.FS.writeFile(
            '/model.brep',
            Uint8Array.from(atob(data.brep), c => c.charCodeAt(0)),
          );
          try {
            count = instance.load('/model.brep');
          } finally {
            module.FS.unlink('/model.brep');
          }
        } else count = instance.loadMesh(data.vertices);
        engine.current = instance;
        setFaces(count);
        element.dataset.engine = 'OCCT 7.9.2 AIS/V3d WebGL2';
        element.dataset.renderedTriangles = String(data.triangles);
        element.dataset.renderedFaces = String(count);
        element.dataset.geometry = data.brep ? 'brep' : 'mesh';
        resize();
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
      if (hoverFrame.current !== null) cancelAnimationFrame(hoverFrame.current);
      try {
        instance?.dispose();
        instance?.delete();
      } catch {
        /* Lost WebGL context. */
      }
      if (instance) element.getContext('webgl2')?.getExtension('WEBGL_lose_context')?.loseContext();
    };
  }, [data]);
  useEffect(() => {
    if (!ready || tab !== 'model') return;
    const frame = requestAnimationFrame(() => {
      const r = ratio();
      try {
        const viewer = engine.current;
        if (!viewer) return;
        viewer.pose(
          view.yaw,
          view.pitch,
          view.zoom,
          Math.round(view.x * r),
          Math.round(view.y * r),
        );
        setProjected(
          (measurement.points || measurement.items.map(i => i.center)).map(p =>
            viewer.project(p[0], p[1], p[2]).map(v => v / r),
          ),
        );
      } catch (error) {
        setReady(false);
        callbacks.current.onError('OCCT camera failed: ' + String(error));
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [view, ready, measurement, size, tab]);
  useEffect(() => {
    if (ready)
      try {
        engine.current?.mode(mode);
      } catch (error) {
        setInteractionError(String(error));
      }
  }, [mode, ready]);
  const offset =
    data.bounds[section.axis] +
    ((data.bounds[section.axis + 3] - data.bounds[section.axis]) * section.position) / 100;
  useEffect(() => {
    if (ready)
      try {
        engine.current?.section(section.axis, offset, section.flip, section.enabled);
      } catch (error) {
        setInteractionError(String(error));
      }
  }, [section, offset, ready]);
  const coordinates = (x: number, y: number) => {
    const rect = canvas.current!.getBoundingClientRect();
    return [Math.round((x - rect.left) * ratio()), Math.round((y - rect.top) * ratio())];
  };
  return (
    <div
      className="rp-cad"
      data-zoom={view.zoom}
      data-yaw={view.yaw}
      data-pan-x={view.x}
      data-pan-y={view.y}
      data-section={section.enabled}
      data-selected={measurement.items.length}
    >
      <div className="rp-cad-heading">
        <strong>{data.name}</strong>
        <span>
          OCCT · {data.brep ? `${faces} faces` : `${data.triangles.toLocaleString()} triangles`}
        </span>
        <div className="rp-cad-tabs" role="tablist" aria-label="CAD 查看模式">
          <button role="tab" aria-selected={tab === 'model'} onClick={() => setTab('model')}>
            三维模型
          </button>
          <button
            role="tab"
            aria-selected={tab === 'sketch'}
            disabled={!data.sketches?.length}
            title={
              data.sketches === undefined
                ? '此预览缺少草图数据，请用 FreeCAD inspect/export 生成新预览。'
                : '查看原生草图与约束'
            }
            onClick={() => setTab('sketch')}
          >
            草图与约束
          </button>
        </div>
      </div>
      <div className="rp-cad-model" style={{ display: tab === 'model' ? 'flex' : 'none' }}>
        <div className="rp-cad-tools">
          <label>
            选择{' '}
            <select
              aria-label="选择面或边"
              value={mode}
              disabled={!ready || !data.brep}
              onChange={e => setMode(Number(e.target.value))}
            >
              <option value={0}>关闭</option>
              <option value={4}>面</option>
              <option value={2}>边</option>
            </select>
          </label>
          <button
            disabled={!ready || !measurement.items.length}
            onClick={() =>
              run(viewer => {
                viewer.clearSelection();
                setMeasurement({ items: [] });
              })
            }
          >
            清除选择
          </button>
          <label>
            <input
              type="checkbox"
              aria-label="剖切"
              checked={section.enabled}
              disabled={!ready}
              onChange={e => setSection(s => ({ ...s, enabled: e.target.checked }))}
            />
            剖切
          </label>
          {section.enabled && (
            <>
              <select
                aria-label="剖切轴"
                value={section.axis}
                onChange={e => setSection(s => ({ ...s, axis: Number(e.target.value) }))}
              >
                <option value={0}>X</option>
                <option value={1}>Y</option>
                <option value={2}>Z</option>
              </select>
              <input
                aria-label="剖切位置"
                type="range"
                min={0}
                max={100}
                step={0.1}
                value={section.position}
                onChange={e => setSection(s => ({ ...s, position: Number(e.target.value) }))}
              />
              <span>{number(offset)} mm</span>
              <button
                aria-pressed={section.flip}
                onClick={() => setSection(s => ({ ...s, flip: !s.flip }))}
              >
                反向
              </button>
            </>
          )}
        </div>
        <div className="rp-cad-model-body">
          <div
            ref={host}
            className="rp-cad-viewport"
            onContextMenu={e => e.preventDefault()}
            onPointerDown={e => {
              if (!ready) return;
              drag.current = {
                x: e.clientX,
                y: e.clientY,
                pan: e.shiftKey || e.button === 2,
                moved: 0,
              };
              try {
                e.currentTarget.setPointerCapture(e.pointerId);
              } catch {
                /* Synthetic probe. */
              }
            }}
            onPointerMove={e => {
              if (!ready) return;
              const d = drag.current;
              if (!d) {
                if (!mode || hoverFrame.current !== null) return;
                const [x, y] = coordinates(e.clientX, e.clientY);
                hoverFrame.current = requestAnimationFrame(() => {
                  hoverFrame.current = null;
                  run(viewer => viewer.hover(x, y));
                });
                return;
              }
              const dx = e.clientX - d.x,
                dy = e.clientY - d.y;
              drag.current = {
                ...d,
                x: e.clientX,
                y: e.clientY,
                moved: d.moved + Math.hypot(dx, dy),
              };
              if (!dx && !dy) return;
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
            onPointerUp={e => {
              const d = drag.current;
              drag.current = null;
              if (!d || d.pan || d.moved > 3 || !mode) return;
              const [x, y] = coordinates(e.clientX, e.clientY);
              run(viewer => setMeasurement(JSON.parse(viewer.select(x, y))));
            }}
            onPointerCancel={() => {
              drag.current = null;
            }}
          >
            <canvas ref={canvas} id={canvasId} aria-label="OCCT CAD solid" />
            <svg
              className="rp-cad-measure-overlay"
              width={size.width}
              height={size.height}
              aria-label="尺寸测量标注"
            >
              {measurement.distance !== undefined && projected.length === 2 ? (
                <g>
                  <line
                    x1={projected[0][0]}
                    y1={projected[0][1]}
                    x2={projected[1][0]}
                    y2={projected[1][1]}
                  />
                  {projected.map((p, i) => (
                    <circle key={i} cx={p[0]} cy={p[1]} r={4} />
                  ))}
                  <text
                    x={(projected[0][0] + projected[1][0]) / 2}
                    y={(projected[0][1] + projected[1][1]) / 2 - 10}
                  >
                    {number(measurement.distance)} mm
                  </text>
                </g>
              ) : (
                measurement.items.map(
                  (item, i) =>
                    projected[i] && (
                      <text key={i} x={projected[i][0]} y={projected[i][1] - 12}>
                        {item.radius !== undefined
                          ? `Ø ${number(item.radius * 2)} mm`
                          : item.length !== undefined
                            ? `${number(item.length)} mm`
                            : `${number(item.area!)} mm²`}
                      </text>
                    ),
                )
              )}
            </svg>
          </div>
          {mode !== 0 && (
            <aside className="rp-cad-inspector rp-cad-measurements">
              <h4>尺寸测量</h4>
              <p>点击面或边。选择两个对象查看最短距离，再点已选对象取消。</p>
              {measurement.items.map((item, i) => (
                <div
                  key={`${item.kind}-${item.index}`}
                  className="rp-cad-measure-item"
                  data-kind={item.kind}
                  data-index={item.index}
                  data-length={item.length}
                  data-radius={item.radius}
                  data-area={item.area}
                >
                  <strong>
                    {i + 1}. {item.kind === 'face' ? '面' : '边'} #{item.index}
                  </strong>
                  {item.length !== undefined && <span>边长 {number(item.length)} mm</span>}
                  {item.area !== undefined && <span>面积 {number(item.area)} mm²</span>}
                  {item.radius !== undefined && (
                    <>
                      <span>半径 {number(item.radius)} mm</span>
                      <span>直径 {number(item.radius * 2)} mm</span>
                    </>
                  )}
                </div>
              ))}
              {measurement.distance !== undefined && (
                <output data-distance={measurement.distance} className="rp-cad-distance">
                  最短距离 <strong>{number(measurement.distance)} mm</strong>
                </output>
              )}
              <small>依据当前 BREP 几何计算 · mm / mm²</small>
            </aside>
          )}
        </div>
        <small className="rp-cad-note">
          拖动旋转 · Shift/右键拖动平移 · 滚轮缩放{!data.brep && ' · 面/边精确测量需要 BREP 预览'}
        </small>
      </div>
      {tab === 'sketch' && (
        <SketchViewport
          sketches={data.sketches || []}
          view={sketchView}
          setView={setSketchView}
          zoom={sketchZoom}
        />
      )}
      {interactionError && (
        <p className="rp-cad-warning" role="alert">
          {interactionError}
        </p>
      )}
    </div>
  );
}
