// Adapted from eda-harness-demo/src/features/replay/PlanTodo.tsx for Kimi's live Todo display blocks.
import { useId, useState } from 'react';
import { Check, ChevronDown, Circle, CircleDot, ListChecks, LoaderCircle } from 'lucide-react';

export function TodoList({
  items,
  running,
}: {
  items: Array<{ title: string; status: 'pending' | 'in_progress' | 'done' }>;
  running: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const listId = useId();
  const done = items.filter(item => item.status === 'done').length;
  const current =
    items.find(item => item.status === 'in_progress') ||
    items.find(item => item.status === 'pending');
  if (!items.length) return null;
  return (
    <section className="ia-todo-wrap" aria-label="Agent todo list">
      <div className="ia-todo">
        <button
          type="button"
          className="ia-todo-title"
          aria-expanded={expanded}
          aria-controls={listId}
          aria-label={expanded ? '收起任务列表' : '展开任务列表'}
          onClick={() => setExpanded(value => !value)}
        >
          <ListChecks size={15} aria-hidden="true" />
          <span className="ia-todo-label">任务</span>
          <span className="ia-todo-count">
            {done}/{items.length}
          </span>
          <span className="ia-todo-current" title={current?.title}>
            {current?.title || '全部完成'}
          </span>
          <span
            className="ia-todo-progress"
            role="progressbar"
            aria-label="任务完成进度"
            aria-valuemin={0}
            aria-valuemax={items.length}
            aria-valuenow={done}
          >
            <span style={{ width: `${(done / items.length) * 100}%` }} />
          </span>
          <ChevronDown size={14} className={expanded ? 'expanded' : ''} aria-hidden="true" />
        </button>
        {expanded && (
          <ol id={listId}>
            {items.map((item, index) => (
              <li key={`${item.title}:${index}`} data-status={item.status}>
                <span
                  className={`ia-todo-status ${item.status === 'in_progress' && running ? 'ia-todo-spin' : ''}`}
                  aria-label={
                    item.status === 'done'
                      ? '已完成'
                      : item.status === 'in_progress'
                        ? '当前项'
                        : '待办'
                  }
                >
                  {item.status === 'done' ? (
                    <Check size={14} aria-hidden="true" />
                  ) : item.status === 'in_progress' && running ? (
                    <LoaderCircle size={14} aria-hidden="true" />
                  ) : item.status === 'in_progress' ? (
                    <CircleDot size={14} aria-hidden="true" />
                  ) : (
                    <Circle size={12} aria-hidden="true" />
                  )}
                </span>
                <span>{item.title}</span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}
