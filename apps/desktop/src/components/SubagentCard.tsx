import { memo } from 'react';
import type { SubagentState } from '@industrial-agent-harness/viewer-builtin/api';
import { useDisplayText } from '@industrial-agent-harness/viewer-builtin/text';
import { AnswerMarkdown } from './AnswerMarkdown';

const statuses = {
  running: 'Running',
  awaiting_approval: 'Awaiting approval',
  completed: 'Completed',
  failed: 'Failed',
  cancelled: 'Stopped',
};
export const SubagentCard = memo(function SubagentCard({ state }: { state: SubagentState }) {
  const { t } = useDisplayText();
  return (
    <details
      className={`ia-subagent-card ${state.status === 'failed' ? 'error' : ''}`}
      data-subagent-id={state.agentId}
    >
      <summary>
        <span className="ia-subagent-title">{state.description}</span>
        <span className="ia-subagent-role">
          {state.subagentType}
          {state.background ? ` · ${t('Background')}` : ''}
        </span>
        <span className={`ia-subagent-status ${state.status}`} role="status">
          {t(statuses[state.status])}
        </span>
      </summary>
      <div className="ia-subagent-content">
        {state.summary ? (
          <AnswerMarkdown text={state.summary} />
        ) : (
          <small>{t(statuses[state.status])}</small>
        )}
      </div>
    </details>
  );
});
