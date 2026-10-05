import { memo } from 'react';
import type {
  SubagentDisplayEvent,
  SubagentState,
} from '@industrial-agent-harness/viewer-builtin/api';
import { ThinkingPreview } from './ThinkingPreview';
import { AnswerMarkdown } from './AnswerMarkdown';

const labels = {
  running: '进行中',
  awaiting_approval: '等待审批',
  completed: '已完成',
  failed: '失败',
  cancelled: '已停止',
  lost: '已中断',
};
const roles: Record<string, string> = { coder: '编程', explore: '探索', plan: '规划' };

export const SubagentCard = memo(function SubagentCard({
  state,
  events,
}: {
  state: SubagentState;
  events: SubagentDisplayEvent[];
}) {
  const tools = new Map<string, Extract<SubagentDisplayEvent, { type: 'tool' }>>();
  const results = new Map<string, Extract<SubagentDisplayEvent, { type: 'tool-result' }>>();
  const first = new Map<string, number>();
  for (const [index, event] of events.entries()) {
    if (event.type === 'tool') {
      tools.set(event.id, event);
      if (!first.has(event.id)) first.set(event.id, index);
    }
    if (event.type === 'tool-result') results.set(event.id, event);
  }
  const running = state.status === 'running';
  return (
    <details
      className={`ia-subagent-card ${['failed', 'lost'].includes(state.status) ? 'error' : ''}`}
      data-subagent-id={state.agentId}
    >
      <summary>
        <span className="ia-subagent-title">{state.description}</span>
        <span className="ia-subagent-role">
          {roles[state.subagentType] || state.subagentType}
          {state.background ? ' · 后台' : ''}
        </span>
        <span className={`ia-subagent-status ${state.status}`} role="status">
          {labels[state.status]}
        </span>
      </summary>
      <div className="ia-subagent-content">
        {events.map((event, index) => {
          if (event.type === 'thinking')
            return (
              <ThinkingPreview
                key={index}
                text={event.text}
                active={running && index === events.length - 1}
              />
            );
          if (event.type === 'text')
            return (
              <AnswerMarkdown
                key={index}
                text={event.text}
                active={running && index === events.length - 1}
              />
            );
          if (event.type === 'tool') {
            if (first.get(event.id) !== index) return null;
            const tool = tools.get(event.id)!;
            const result = results.get(event.id);
            return (
              <details className={`ia-agent-tool ${result?.error ? 'error' : ''}`} key={index}>
                <summary>
                  {result?.error ? '工具失败' : result ? '工具完成' : '使用工具'} · {tool.name}
                </summary>
                <div className="ia-tool-detail">
                  <small>输入</small>
                  <pre>{tool.arguments || '无参数'}</pre>
                  {result && (
                    <>
                      <small>结果</small>
                      <pre>{result.output || result.message}</pre>
                      {result.outputTruncated && <small>显示已缩短</small>}
                    </>
                  )}
                </div>
              </details>
            );
          }
          if (event.type === 'tool-result')
            return tools.has(event.id) ? null : (
              <pre key={index}>{event.output || event.message}</pre>
            );
          if (event.type === 'compaction')
            return (
              <small key={index}>
                {event.state === 'begin' ? '正在整理上下文…' : '上下文已整理'}
              </small>
            );
          return null;
        })}
        {state.summary &&
          !events.some(e => e.type === 'text' && e.text.includes(state.summary!)) && (
            <AnswerMarkdown text={state.summary} />
          )}
        {state.truncated && <small>过程显示已缩短，完整记录保留在 Kimi 会话中。</small>}
        {!events.length && !state.summary && (
          <small>{running ? '子任务正在执行…' : labels[state.status]}</small>
        )}
      </div>
    </details>
  );
});
