import { useDisplayText } from '@industrial-agent-harness/viewer-builtin/text';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChatTurn } from '@industrial-agent-harness/viewer-builtin/api';

const MAX_TICKS = 80;

type Tick = {
  id: string;
  preview: string;
  hasReply: boolean;
  weight: number;
  turnIndex: number;
};

function preview(turn: ChatTurn) {
  return turn.task.replace(/\s+/g, ' ').trim();
}

// A per-turn tick rail beside the transcript. Ticks sit at the scroll
// position of their turn (a minimap), so they cluster wherever messages
// cluster; short transcripts collapse into one dense centered cluster.
// Hover stretches the tick under the cursor and follows it with a
// preview card; click scrolls to that turn.
export function MessageRail({ turns }: { turns: ChatTurn[] }) {
  const { t } = useDisplayText();
  const area = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [mouseY, setMouseY] = useState(0);
  const [active, setActive] = useState(0);
  const [positions, setPositions] = useState<number[]>([]);
  const [dense, setDense] = useState(true);
  const ticks = useMemo<Tick[]>(() => {
    const step = Math.max(1, Math.ceil(turns.length / MAX_TICKS));
    const list: Tick[] = [];
    for (let index = 0; index < turns.length; index += step) {
      const turn = turns[index];
      const text = preview(turn);
      const reply = turn.events.some(event => event.type === 'text');
      list.push({
        id: turn.id,
        preview: text || t('Empty message'),
        hasReply: reply,
        weight: Math.min(1, 0.25 + text.length / 400),
        turnIndex: index,
      });
    }
    return list;
  }, [turns, t]);
  useEffect(() => {
    // The scroll container is a sibling of the rail, not a descendant.
    const container = area.current
      ?.closest('.ia-chat-scroll-area')
      ?.querySelector('.ia-chat-scroll');
    if (!container) return;
    const run = () => {
      const box = container as HTMLElement;
      const boxTop = box.getBoundingClientRect().top;
      const scrollable = box.scrollHeight - box.clientHeight > 40;
      setDense(!scrollable);
      const nodes = box.querySelectorAll<HTMLElement>('[data-turn-id]');
      const range = Math.max(1, box.scrollHeight - box.clientHeight);
      const next = ticks.map((tick, index) => {
        if (!scrollable) return ticks.length > 1 ? index / (ticks.length - 1) : 0;
        const node = nodes[tick.turnIndex];
        if (!node) return 0;
        const top = node.getBoundingClientRect().top - boxTop + box.scrollTop + 8;
        // Fractions of the scrollable range, so the tick sits where the
        // scrollbar thumb rests when that turn tops the viewport.
        return Math.min(100, Math.max(0, (top / range) * 100));
      });
      setPositions(next);
      let nearest = 0;
      let best = Infinity;
      nodes.forEach(node => {
        const distance = Math.abs(node.getBoundingClientRect().top - boxTop);
        if (distance < best) {
          best = distance;
          nearest = Number(node.dataset.turnIndex ?? 0);
        }
      });
      setActive(nearest);
    };
    // Scroll events already arrive at frame cadence and ResizeObserver is
    // low-frequency; scheduling through rAF would stall in occluded windows.
    const schedule = () => run();
    run();
    // Styles and async content land after the first paint; re-measure.
    const settle = setTimeout(run, 250);
    const settle2 = setTimeout(run, 900);
    const observer = new ResizeObserver(schedule);
    observer.observe(container);
    container.addEventListener('scroll', schedule, { passive: true });
    return () => {
      clearTimeout(settle);
      clearTimeout(settle2);
      observer.disconnect();
      container.removeEventListener('scroll', schedule);
    };
  }, [ticks]);
  if (ticks.length < 2) return null;
  function jump(tick: Tick) {
    // Turns live in the sibling `.ia-chat-scroll`, not inside the rail.
    const node = area.current
      ?.closest('.ia-chat-scroll-area')
      ?.querySelector(`[data-turn-id="${CSS.escape(tick.id)}"]`);
    node?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  return (
    <div
      className={`ia-message-rail ${dense ? 'dense' : ''}`}
      ref={area}
      onMouseLeave={() => setHover(null)}
      onMouseMove={event => {
        const box = event.currentTarget.getBoundingClientRect();
        setMouseY(event.clientY - box.top);
      }}
    >
      {ticks.map((tick, index) => {
        const distance = hover === null ? Infinity : Math.abs(hover - index);
        const emphasis = distance === 0 ? 1.7 : distance === 1 ? 1.3 : distance === 2 ? 1.1 : 1;
        return (
          <button
            key={tick.id}
            className={`ia-rail-tick ${active === tick.turnIndex ? 'current' : ''}`}
            style={{
              top: `${positions[index] ?? 0}%`,
              transform: `scaleX(${emphasis})`,
            }}
            onMouseEnter={() => setHover(index)}
            onFocus={() => setHover(index)}
            onClick={() => jump(tick)}
            aria-label={t('Jump to message {0}', { '0': index + 1 })}
            aria-current={active === tick.turnIndex ? 'true' : undefined}
          >
            <span style={{ width: `${10 + tick.weight * 6}px` }} />
          </button>
        );
      })}
      {hover !== null && ticks[hover] && (
        <div
          className="ia-rail-preview"
          role="tooltip"
          style={{
            top: Math.max(8, Math.min(mouseY - 24, (area.current?.clientHeight || 400) - 96)),
          }}
        >
          <b>{ticks[hover].preview}</b>
          <small>
            {ticks[hover].hasReply ? t('Assistant replied') : t('No assistant reply yet')}
          </small>
        </div>
      )}
    </div>
  );
}
