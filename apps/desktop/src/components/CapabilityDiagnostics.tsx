import { useDisplayText } from '@industrial-agent-harness/viewer-builtin/text';
import type { DomainStatus } from './CapabilityPacks';

export function DiagnosticsSection({
  status,
  statusError,
  onRefresh,
  onGoToPacks,
}: {
  status?: DomainStatus;
  statusError: string;
  onRefresh: () => void;
  onGoToPacks: () => void;
}) {
  const { t } = useDisplayText();
  const errors = status?.errors || [];
  return (
    <section className="ia-capability-section" aria-label={t('Runtime diagnostics')}>
      <div className="ia-capability-section-head">
        <h2>{t('Runtime diagnostics')}</h2>
        <button onClick={onRefresh}>{t('Check updates')}</button>
      </div>
      <p>{t('Pack errors and catalog warnings from the last status check.')}</p>
      {statusError && (
        <p role="alert" className="ia-project-error">
          {t(statusError)}
        </p>
      )}
      {status?.catalogWarning && (
        <p role="status" className="ia-capability-note">
          {t('Updates unavailable. Bundled domains can still be installed.')}
        </p>
      )}
      {!errors.length && !statusError && !status?.catalogWarning && (
        <p>{t('No issues reported.')}</p>
      )}
      {errors.map(item => (
        <div key={`${item.domain}:${item.message}`} className="ia-diagnostic-row" role="alert">
          <span>
            <b>{item.domain}</b>
            <small>{item.message}</small>
          </span>
          <button onClick={onGoToPacks}>{t('Open domain packs')}</button>
        </div>
      ))}
    </section>
  );
}
