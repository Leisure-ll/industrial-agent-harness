import { useDisplayText } from '@industrial-agent-harness/viewer-builtin/text';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChatTurn } from '@industrial-agent-harness/viewer-builtin/api';

const MAX_TICKS = 80;
const TICK_PITCH = 8;

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

// Keep ticks in a compact group regardless of the transcript's scroll height.
// Sample long histories to fit half the viewport, retaining both endpoints.
export function MessageRail({ turns }: { turns: ChatTurn[] }) {
  const { t } = useDisplayText();
  const area = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [mouseY, setMouseY] = useState(0);
  const [active, setActive] = useState(0);
  const [limit, setLimit] = useState(MAX_TICKS);
  const ticks = useMemo<Tick[]>(() => {
    const count = Math.min(turns.length, limit);
    return Array.from({ length: count }, (_, sample) => {
      const index = count < 2 ? 0 : Math.round((sample * (turns.length - 1)) / (count - 1));
      const turn = turns[index];
      const text = preview(turn);
      const reply = turn.events.some(event => event.type === 'text');
      return {
        id: turn.id,
        preview: text || t('Empty message'),
        hasReply: reply,
        weight: Math.min(1, 0.25 + text.length / 400),
        turnIndex: index,
      };
    });
  }, [turns, limit, t]);
  useEffect(() => {
    // The scroll container is a sibling of the rail, not a descendant.
    const container = area.current
      ?.closest('.ia-chat-scroll-area')
      ?.querySelector('.ia-chat-scroll');
    if (!container) return;
    const run = () => {
      const box = container as HTMLElement;
      const boxTop = box.getBoundingClientRect().top;
      setLimit(Math.max(2, Math.min(MAX_TICKS, Math.floor(box.clientHeight / 2 / TICK_PITCH))));
      const nodes = box.querySelectorAll<HTMLElement>('[data-turn-id]');
      // A tall reply remains current until the following turn reaches the top.
      let current = 0;
      nodes.forEach(node => {
        if (node.getBoundingClientRect().top <= boxTop + 12) {
          current = Number(node.dataset.turnIndex ?? 0);
        }
      });
      if (box.scrollHeight - box.clientHeight - box.scrollTop < 2) current = turns.length - 1;
      setActive(current);
    };
    // Scroll events already arrive at frame cadence and ResizeObserver is
    // low-frequency; scheduling through rAF would stall in occluded windows.
    const schedule = () => run();
    run();
    const observer = new ResizeObserver(schedule);
    observer.observe(container);
    container.querySelectorAll('[data-turn-id]').forEach(node => observer.observe(node));
    container.addEventListener('scroll', schedule, { passive: true });
    return () => {
      observer.disconnect();
      container.removeEventListener('scroll', schedule);
    };
  }, [turns]);
  if (ticks.length < 2) return null;
  const hovered = ticks.findIndex(tick => tick.id === hover);
  const currentTick = ticks.reduce(
    (nearest, tick, index) =>
      Math.abs(tick.turnIndex - active) < Math.abs(ticks[nearest].turnIndex - active)
        ? index
        : nearest,
    0,
  );
  function jump(tick: Tick) {
    // Turns live in the sibling `.ia-chat-scroll`, not inside the rail.
    const node = area.current
      ?.closest('.ia-chat-scroll-area')
      ?.querySelector(`[data-turn-id="${CSS.escape(tick.id)}"]`);
    node?.scrollIntoView({
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
        ? 'instant'
        : 'smooth',
      block: 'start',
    });
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
      <div className="ia-rail-ticks">
        {ticks.map((tick, index) => {
          const distance = hovered < 0 ? Infinity : Math.abs(hovered - index);
          const emphasis = distance === 0 ? 1.7 : distance === 1 ? 1.3 : distance === 2 ? 1.1 : 1;
          return (
            <button
              key={tick.id}
              className={`ia-rail-tick ${currentTick === index ? 'current' : ''}`}
              style={{
                transform: `scaleX(${emphasis})`,
              }}
              onMouseEnter={() => setHover(tick.id)}
              onFocus={event => {
                setHover(tick.id);
                const box = event.currentTarget.getBoundingClientRect();
                setMouseY(
                  box.top + box.height / 2 - (area.current?.getBoundingClientRect().top ?? 0),
                );
              }}
              onBlur={() => setHover(null)}
              onKeyDown={event => {
                if (event.key === 'Escape') setHover(null);
              }}
              onClick={() => jump(tick)}
              aria-label={t('Jump to message {0}', { '0': tick.turnIndex + 1 })}
              aria-current={currentTick === index ? 'true' : undefined}
            >
              <span style={{ width: `${10 + tick.weight * 6}px` }} />
            </button>
          );
        })}
      </div>
      {hovered >= 0 && (
        <div
          className="ia-rail-preview"
          role="tooltip"
          style={{
            top: Math.max(8, Math.min(mouseY - 24, (area.current?.clientHeight || 400) - 96)),
          }}
        >
          <b>{ticks[hovered].preview}</b>
          <small>
            {ticks[hovered].hasReply ? t('Assistant replied') : t('No assistant reply yet')}
          </small>
        </div>
      )}
    </div>
  );
}
