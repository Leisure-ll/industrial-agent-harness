import { useDisplayText } from '@industrial-agent-harness/viewer-builtin/text';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';

export function WorkspaceDivider({
  workspace,
  width,
  onChange,
  fullscreen,
}: {
  workspace: RefObject<HTMLElement | null>;
  width: number | null;
  onChange: (width: number | null) => void;
  fullscreen: boolean;
}) {
  const { t } = useDisplayText();
  const divider = useRef<HTMLDivElement>(null);
  const drag = useRef<{ pointer: number; x: number; width: number } | null>(null);
  const chosenWidth = useRef(width);
  chosenWidth.current = width;
  const [bounds, setBounds] = useState({ min: 360, max: 1000, current: 490 });
  const limits = useCallback(() => {
    const handle = divider.current,
      panel = workspace.current;
    const chat = handle?.previousElementSibling as HTMLElement | null;
    if (!handle?.parentElement || !panel || !chat) return { min: 360, max: 1000, current: 490 };
    const available =
      handle.parentElement.getBoundingClientRect().right - chat.getBoundingClientRect().left;
    const min = parseFloat(getComputedStyle(panel).minWidth);
    const max = Math.max(
      min,
      available - parseFloat(getComputedStyle(chat).minWidth) - handle.offsetWidth,
    );
    return { min, max, current: panel.getBoundingClientRect().width };
  }, [workspace]);
  const clamp = (value: number) => {
    const { min, max } = limits();
    return Math.max(min, Math.min(max, value));
  };
  useEffect(() => {
    if (fullscreen) {
      drag.current = null;
      return;
    }
    const handle = divider.current;
    if (!handle?.parentElement || !workspace.current) return;
    const update = () => {
      const next = limits();
      setBounds(next);
      const selected = chosenWidth.current;
      if (selected !== null && (selected < next.min || selected > next.max))
        onChange(Math.max(next.min, Math.min(next.max, selected)));
    };
    const observer = new ResizeObserver(update);
    observer.observe(handle.parentElement);
    observer.observe(handle.previousElementSibling!);
    observer.observe(workspace.current);
    update();
    return () => {
      observer.disconnect();
      drag.current = null;
    };
  }, [fullscreen, workspace, onChange, limits]);
  return (
    <div
      ref={divider}
      className="ia-workspace-divider"
      hidden={fullscreen}
      role="separator"
      aria-label={t('Resize chat and workspace')}
      aria-orientation="vertical"
      aria-valuemin={Math.round(bounds.min)}
      aria-valuemax={Math.round(bounds.max)}
      aria-valuenow={Math.round(bounds.current)}
      tabIndex={0}
      title={t('Drag to resize chat and Viewer; double-click to reset')}
      onPointerDown={e => {
        if (e.button !== 0) return;
        drag.current = { pointer: e.pointerId, x: e.clientX, width: limits().current };
        e.preventDefault();
        e.currentTarget.focus();
        try {
          e.currentTarget.setPointerCapture(e.pointerId);
        } catch {
          /* Synthetic selftest. */
        }
      }}
      onPointerMove={e => {
        const start = drag.current;
        if (start?.pointer === e.pointerId) onChange(clamp(start.width + start.x - e.clientX));
      }}
      onPointerUp={() => {
        drag.current = null;
      }}
      onPointerCancel={() => {
        drag.current = null;
      }}
      onLostPointerCapture={() => {
        drag.current = null;
      }}
      onDoubleClick={() => onChange(null)}
      onKeyDown={e => {
        const current = limits();
        const next =
          e.key === 'ArrowLeft'
            ? current.current + 32
            : e.key === 'ArrowRight'
              ? current.current - 32
              : e.key === 'Home'
                ? current.max
                : e.key === 'End'
                  ? current.min
                  : undefined;
        if (next !== undefined) {
          e.preventDefault();
          onChange(clamp(next));
        }
      }}
    />
  );
}
