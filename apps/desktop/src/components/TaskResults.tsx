import { useState, useRef } from 'react';
import type {
  TaskResultView,
  ResultOpenRequest,
} from '@industrial-agent-harness/viewer-builtin/api';
import { useDisplayText } from '@industrial-agent-harness/viewer-builtin/text';

export function TaskResults({
  results,
  onOpen,
}: {
  results: TaskResultView;
  onOpen?: (request: ResultOpenRequest) => Promise<void>;
}) {
  const { t } = useDisplayText();
  const [opening, setOpening] = useState('');
  const [error, setError] = useState('');
  const pending = useRef(false);
  async function open(groupId: string, artifactId: string, reveal = false) {
    if (!onOpen || pending.current) return;
    pending.current = true;
    setOpening(artifactId);
    setError('');
    try {
      const request = { chatId: results.chatId, turnId: results.turnId, groupId, artifactId };
      await onOpen({ ...request, revealOnly: reveal });
    } catch (reason) {
      setError(String(reason));
    } finally {
      pending.current = false;
      setOpening('');
    }
  }
  function card(group: TaskResultView['groups'][number]) {
    const primary = group.artifacts.find(artifact => artifact.id === group.primaryArtifactId);
    return (
      <article
        className={`ia-result-card ${group.selected ? 'selected' : ''}`}
        key={group.id}
        data-result-id={group.id}
      >
        <div className="ia-result-heading">
          <b>{t(group.title)}</b>
          {group.selected ? <small>{t('Selected result')}</small> : null}
        </div>
        <p className="ia-result-status">
          {group.historical
            ? t('Historical version')
            : group.executionStatus === 'completed'
              ? t('Execution completed')
              : t('Partial result · execution failed')}
        </p>
        <button
          disabled={!onOpen || Boolean(opening) || !primary}
          onClick={() => void open(group.id, group.previewArtifactId || group.primaryArtifactId)}
        >
          {opening
            ? t('Opening…')
            : group.previewArtifactId
              ? t('Preview result')
              : t('Open result')}
        </button>
        <button
          disabled={!onOpen || Boolean(opening) || !primary}
          onClick={() => void open(group.id, group.primaryArtifactId, true)}
        >
          {t('Show native file')}
        </button>
        {group.contentStatus !== 'recorded' ? (
          <p className="ia-flow-error">
            {t(
              group.contentStatus === 'changed'
                ? 'Recorded content changed · checks apply to the previous bytes'
                : group.contentStatus === 'unchecked'
                  ? 'Recorded content has not been checked'
                  : 'Recorded file is unavailable',
            )}
          </p>
        ) : null}
        <details className="ia-result-files">
          <summary>{t('Files and exports')}</summary>
          {group.artifacts.map(artifact => (
            <button
              className="ia-result-file"
              title={artifact.relativePath}
              key={artifact.id}
              disabled={!onOpen || Boolean(opening)}
              onClick={() => void open(group.id, artifact.id)}
            >
              {artifact.relativePath.split('/').at(-1)}
            </button>
          ))}
        </details>
        <div className="ia-result-checks">
          {group.verifications.length ? (
            group.verifications.map(verification => (
              <details key={verification.id}>
                <summary>
                  {t(
                    verification.status === 'passed'
                      ? 'Engineering verification passed'
                      : verification.status === 'failed'
                        ? 'Engineering verification failed'
                        : verification.status === 'not_run'
                          ? 'Engineering verification was not run'
                          : 'Engineering evidence is insufficient',
                  )}
                </summary>
                <p>{verification.reason}</p>
                <small>{t('Verification applies to the recorded version.')}</small>
              </details>
            ))
          ) : (
            <small>{t('Engineering verification was not run')}</small>
          )}
        </div>
      </article>
    );
  }
  const current = results.groups.filter(group => !group.superseded);
  const previous = results.groups.filter(group => group.superseded);
  if (!results.groups.length && !results.actionIds.length && !results.diagnostics?.length)
    return null;
  return (
    <section
      className="ia-task-results"
      aria-label={t('Task results')}
      data-result-turn={results.turnId}
    >
      <div className="ia-result-heading">
        <b>{t('Task results')}</b>
        <small role="status">
          {t(
            results.phase === 'background'
              ? 'Background work is still running'
              : results.executionStatus === 'completed'
                ? 'Results ready'
                : results.phase === 'running'
                  ? 'Results so far'
                  : ['completed', 'finished'].includes(results.requestStatus)
                    ? 'Partial results · some operations failed'
                    : 'Partial results · request not completed',
          )}
        </small>
      </div>
      {current.map(card)}
      {previous.length ? (
        <details>
          <summary>{t('Previous versions')}</summary>
          {previous.map(card)}
        </details>
      ) : null}
      {(results.diagnostics || []).map(message => (
        <p key={message}>{message}</p>
      ))}
      {error ? (
        <p className="ia-flow-error" role="alert">
          {t(error)}
        </p>
      ) : null}
    </section>
  );
}
