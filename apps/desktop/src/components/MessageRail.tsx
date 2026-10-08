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

// A per-turn tick rail beside the transcript: hover expands the tick and
// follows the cursor with a preview card; click scrolls to that turn.
export function MessageRail({ turns }: { turns: ChatTurn[] }) {
  const { t } = useDisplayText();
  const area = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [mouseY, setMouseY] = useState(0);
  const [active, setActive] = useState(0);
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
    const container = area.current?.querySelector('.ia-chat-scroll');
    if (!container) return;
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const top = container.getBoundingClientRect().top;
        let nearest = 0;
        let best = Infinity;
        container.querySelectorAll<HTMLElement>('[data-turn-id]').forEach(node => {
          const distance = Math.abs(node.getBoundingClientRect().top - top);
          if (distance < best) {
            best = distance;
            nearest = Number(node.dataset.turnIndex ?? 0);
          }
        });
        setActive(nearest);
      });
    };
    container.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => {
      cancelAnimationFrame(frame);
      container.removeEventListener('scroll', onScroll);
    };
  }, [turns]);
  if (ticks.length < 2) return null;
  function jump(tick: Tick) {
    const node = area.current?.querySelector(`[data-turn-id="${CSS.escape(tick.id)}"]`);
    node?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  return (
    <div
      className="ia-message-rail"
      ref={area}
      onMouseLeave={() => setHover(null)}
      onMouseMove={event => {
        const box = event.currentTarget.getBoundingClientRect();
        setMouseY(event.clientY - box.top);
      }}
    >
      {ticks.map((tick, index) => {
        const distance = hover === null ? Infinity : Math.abs(hover - index);
        const emphasis = distance === 0 ? 2 : distance === 1 ? 1.4 : distance === 2 ? 1.12 : 1;
        return (
          <button
            key={tick.id}
            className={`ia-rail-tick ${active === tick.turnIndex ? 'current' : ''}`}
            style={{ transform: `scaleX(${emphasis})` }}
            onMouseEnter={() => setHover(index)}
            onFocus={() => setHover(index)}
            onClick={() => jump(tick)}
            aria-label={t('Jump to message {0}', { '0': index + 1 })}
            aria-current={active === tick.turnIndex ? 'true' : undefined}
          >
            <span style={{ width: `${18 + tick.weight * 22}px` }} />
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
