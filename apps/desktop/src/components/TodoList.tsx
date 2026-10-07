import { useDisplayText } from '@industrial-agent-harness/viewer-builtin/text';
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
  const { t } = useDisplayText();
  const [expanded, setExpanded] = useState(false);
  const listId = useId();
  const done = items.filter(item => item.status === 'done').length;
  const current =
    items.find(item => item.status === 'in_progress') ||
    items.find(item => item.status === 'pending');
  if (!items.length) return null;
  return (
    <section className="ia-todo-wrap" aria-label={t('Agent todo list')}>
      <div className="ia-todo">
        <button
          type="button"
          className="ia-todo-title"
          aria-expanded={expanded}
          aria-controls={listId}
          aria-label={t(expanded ? 'Collapse task list' : 'Expand task list')}
          onClick={() => setExpanded(value => !value)}
        >
          <ListChecks size={15} aria-hidden="true" />
          <span className="ia-todo-label">{t('Tasks')}</span>
          <span className="ia-todo-count">
            {done}/{items.length}
          </span>
          <span className="ia-todo-current" title={current?.title}>
            {current?.title || t('All tasks completed')}
          </span>
          <span
            className="ia-todo-progress"
            role="progressbar"
            aria-label={t('Task progress')}
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
                      ? t('Completed')
                      : item.status === 'in_progress'
                        ? t('Current task')
                        : t('Pending')
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
