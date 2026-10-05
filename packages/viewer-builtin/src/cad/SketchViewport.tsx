import { useDisplayText } from '../text';
import { useEffect, useRef, useState } from 'react';
import type { CadSketch, CadSketchGeometry } from '../api';
import { useWheelZoom } from '../navigation';

export type SketchView = { zoom: number; x: number; y: number };
const labels: Record<string, string> = {
  Coincident: '重合',
  Horizontal: '水平',
  Vertical: '垂直',
  Distance: '长度',
  DistanceX: '水平距离',
  DistanceY: '垂直距离',
  Radius: '半径',
  Diameter: '直径',
  Angle: '角度',
  Parallel: '平行',
  Perpendicular: '垂直关系',
  Equal: '相等',
  Tangent: '相切',
};
const dimensional = /^(Distance|DistanceX|DistanceY|Radius|Diameter|Angle)$/;
const format = (n: number) => Number(n.toFixed(4)).toString();
function extent(geometry: CadSketchGeometry[]) {
  const points: number[][] = [];
  for (const g of geometry) {
    if (g.kind === 'line') points.push(g.start, g.end);
    if (g.kind === 'circle')
      points.push(
        [g.center[0] - g.radius, g.center[1] - g.radius],
        [g.center[0] + g.radius, g.center[1] + g.radius],
      );
  }
  if (!points.length) return [0, 0, 10, 10];
  return [
    Math.min(...points.map(p => p[0])),
    Math.min(...points.map(p => -p[1])),
    Math.max(...points.map(p => p[0])),
    Math.max(...points.map(p => -p[1])),
  ];
}
export function SketchViewport({
  sketches,
  view,
  setView,
  zoom,
}: {
  sketches: CadSketch[];
  view: SketchView;
  setView: (value: SketchView | ((v: SketchView) => SketchView)) => void;
  zoom: (factor: number) => void;
}) {
  const { t } = useDisplayText();
  const host = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number } | null>(null);
  const [size, setSize] = useState({ width: 600, height: 400 });
  const [index, setIndex] = useState(0);
  const [constraint, setConstraint] = useState<number | null>(null);
  const [geometry, setGeometry] = useState<number | null>(null);
  const [page, setPage] = useState(0);
  useWheelZoom(host, zoom);
  useEffect(() => {
    if (!host.current) return;
    const observer = new ResizeObserver(([entry]) =>
      setSize({
        width: Math.max(1, entry.contentRect.width),
        height: Math.max(1, entry.contentRect.height),
      }),
    );
    observer.observe(host.current);
    return () => observer.disconnect();
  }, []);
  const sketch = sketches[index];
  if (!sketch)
    return <p className="rp-cad-empty">{t('此模型没有原生草图。STEP 导入不会恢复草图与约束。')}</p>;
  const bounds = extent(sketch.geometry);
  const scale =
    Math.max(
      (bounds[2] - bounds[0]) / (size.width * 0.7),
      (bounds[3] - bounds[1]) / (size.height * 0.7),
      0.0001,
    ) / view.zoom;
  const width = size.width * scale,
    height = size.height * scale;
  const x = (bounds[0] + bounds[2] - width) / 2 - view.x * scale;
  const y = (bounds[1] + bounds[3] - height) / 2 - view.y * scale;
  const selected = sketch.constraints.find(c => c.index === constraint);
  const highlighted = new Set(
    selected
      ? [selected.first, selected.second, selected.third]
      : geometry === null
        ? []
        : [geometry],
  );
  const dimensions = sketch.constraints.filter(c => dimensional.test(c.type)).slice(0, 100);
  return (
    <div className="rp-cad-sketch-body" data-sketch={sketch.name} data-sketch-zoom={view.zoom}>
      <div className="rp-cad-sketch-main">
        <div className="rp-cad-tools">
          <label>
            {t('草图')}{' '}
            <select
              aria-label={t('选择草图')}
              value={index}
              onChange={e => {
                setIndex(Number(e.target.value));
                setConstraint(null);
                setGeometry(null);
                setPage(0);
                setView({ zoom: 1, x: 0, y: 0 });
              }}
            >
              {sketches.map((s, i) => (
                <option key={s.name} value={i}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
          <span className={sketch.fullyConstrained ? 'rp-cad-valid' : 'rp-cad-warning'}>
            {sketch.fullyConstrained ? t('完全约束') : t('未完全约束')}
          </span>
          <span>
            {sketch.geometry.length} {t('个几何 ·')} {sketch.constraints.length} {t('个约束')}
          </span>
        </div>
        <div
          ref={host}
          className="rp-cad-sketch-canvas"
          onPointerDown={e => {
            drag.current = { x: e.clientX, y: e.clientY };
            try {
              e.currentTarget.setPointerCapture(e.pointerId);
            } catch {
              /* Synthetic probe. */
            }
          }}
          onPointerMove={e => {
            if (!drag.current) return;
            const dx = e.clientX - drag.current.x,
              dy = e.clientY - drag.current.y;
            drag.current = { x: e.clientX, y: e.clientY };
            setView(v => ({ ...v, x: v.x + dx, y: v.y + dy }));
          }}
          onPointerUp={() => {
            drag.current = null;
          }}
          onPointerCancel={() => {
            drag.current = null;
          }}
        >
          <svg aria-label={t('FreeCAD 草图与约束')} viewBox={`${x} ${y} ${width} ${height}`}>
            <line className="rp-cad-sketch-axis" x1={x} y1={0} x2={x + width} y2={0} />
            <line className="rp-cad-sketch-axis" x1={0} y1={y} x2={0} y2={y + height} />
            {sketch.geometry.map(g => {
              const props = {
                className: `rp-cad-sketch-geometry ${highlighted.has(g.index) ? 'selected' : ''}`,
                'data-geometry-index': g.index,
                strokeDasharray: g.construction ? '5 4' : undefined,
                onClick: () => {
                  setGeometry(g.index);
                  setConstraint(null);
                },
              };
              if (g.kind === 'line')
                return (
                  <line
                    key={g.index}
                    {...props}
                    x1={g.start[0]}
                    y1={-g.start[1]}
                    x2={g.end[0]}
                    y2={-g.end[1]}
                  />
                );
              if (g.kind === 'circle')
                return (
                  <circle
                    key={g.index}
                    {...props}
                    cx={g.center[0]}
                    cy={-g.center[1]}
                    r={g.radius}
                  />
                );
              return null;
            })}
            {dimensions.map(c => {
              const g = sketch.geometry[c.first];
              if (!g || g.kind === 'unsupported') return null;
              const p =
                g.kind === 'line'
                  ? [(g.start[0] + g.end[0]) / 2, (g.start[1] + g.end[1]) / 2]
                  : [g.center[0] + g.radius * 0.6, g.center[1] + g.radius * 0.4];
              return (
                <text
                  key={c.index}
                  className="rp-cad-sketch-dimension"
                  x={p[0]}
                  y={-p[1] - 8 * scale}
                  fontSize={12 * scale}
                  textAnchor="middle"
                  data-constraint-index={c.index}
                  onClick={() => {
                    setConstraint(c.index);
                    setGeometry(null);
                  }}
                >
                  {c.type === 'Radius' ? 'R ' : c.type === 'Diameter' ? 'Ø ' : ''}
                  {format(c.type === 'Angle' ? (c.value * 180) / Math.PI : c.value)}{' '}
                  {c.type === 'Angle' ? '°' : 'mm'}
                </text>
              );
            })}
          </svg>
        </div>
        <small className="rp-cad-note">
          {t('草图局部坐标 · mm · 原点位置 (')}
          {sketch.origin.map(format).join(', ')}
          {t(') · 拖动平移')}
        </small>
      </div>
      <aside className="rp-cad-inspector">
        <h4>{t('草图约束')}</h4>
        <p>{t('点击约束查看相关几何。')}</p>
        <div className="rp-cad-constraints">
          {sketch.constraints.slice(page * 100, (page + 1) * 100).map(c => (
            <button
              key={c.index}
              aria-pressed={constraint === c.index}
              data-constraint-index={c.index}
              onClick={() => {
                setConstraint(c.index);
                setGeometry(null);
              }}
            >
              <span>
                #{c.index + 1} {t(labels[c.type] || c.type)}
              </span>
              {dimensional.test(c.type) && (
                <strong>
                  {format(c.type === 'Angle' ? (c.value * 180) / Math.PI : c.value)}{' '}
                  {c.type === 'Angle' ? '°' : 'mm'}
                </strong>
              )}
              <small>
                {[c.first, c.second, c.third]
                  .filter((v, i, a) => v >= 0 && a.indexOf(v) === i)
                  .map(v => t('几何 {0}', { '0': v + 1 }))
                  .join(' · ')}
                {c.driving === false ? t(' · 参考尺寸') : ''}
              </small>
            </button>
          ))}
        </div>
        {sketch.constraints.length > 100 && (
          <div className="rp-cad-tools">
            <button disabled={!page} onClick={() => setPage(p => p - 1)}>
              {t('上一页')}
            </button>
            <button
              disabled={(page + 1) * 100 >= sketch.constraints.length}
              onClick={() => setPage(p => p + 1)}
            >
              {t('下一页')}
            </button>
          </div>
        )}
        {sketch.geometry.some(g => g.kind === 'unsupported') && (
          <p className="rp-cad-warning">{t('部分曲线类型暂不绘制，原生约束仍保留。')}</p>
        )}
      </aside>
    </div>
  );
}
