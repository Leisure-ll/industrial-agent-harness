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

const AGENT_HUES = 6;
const PETALS = [0, 1, 2, 3, 4].map(i => {
  const angle = (i * 2 * Math.PI) / 5 - Math.PI / 2;
  return { cx: 8 + 4.1 * Math.cos(angle), cy: 8 + 4.1 * Math.sin(angle) };
});
// Deterministic identity color: the same subagent keeps its hue across turns,
// parallel siblings split across the palette.
const agentHue = (seed: string) => {
  let hash = 5381;
  for (let index = 0; index < seed.length; index++)
    hash = ((hash * 33) ^ seed.charCodeAt(index)) >>> 0;
  return hash % AGENT_HUES;
};
export const AgentGlyph = ({ seed, className = '' }: { seed: string; className?: string }) => (
  <span
    className={`ia-subagent-icon ${className}`}
    data-agent-hue={agentHue(seed)}
    aria-hidden="true"
  >
    <svg viewBox="0 0 16 16" aria-hidden="true">
      {PETALS.map((petal, index) => (
        <circle
          key={index}
          cx={petal.cx}
          cy={petal.cy}
          r="3.4"
          fill="currentColor"
          opacity="0.82"
        />
      ))}
      <circle cx="8" cy="8" r="2.5" fill="currentColor" />
    </svg>
  </span>
);
export const agentGlyphSeed = (
  state: Pick<SubagentState, 'agentId' | 'subagentType' | 'description'>,
) => `${state.agentId}:${state.subagentType}:${state.description}`;

export const SubagentCard = memo(function SubagentCard({ state }: { state: SubagentState }) {
  const { t } = useDisplayText();
  return (
    <details
      className={`ia-subagent-card ${state.status === 'failed' ? 'error' : ''}`}
      data-subagent-id={state.agentId}
    >
      <summary>
        <AgentGlyph seed={agentGlyphSeed(state)} />
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
