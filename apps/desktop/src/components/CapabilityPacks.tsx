import { useDisplayText } from '@industrial-agent-harness/viewer-builtin/text';
import { useEffect, useState } from 'react';
import type { DomainOption } from '@industrial-agent-harness/viewer-builtin/api';

export type DomainStatus = Awaited<
  ReturnType<NonNullable<typeof window.viewerHost>['domainStatus']>
>;
export type AvailablePack = Awaited<
  ReturnType<NonNullable<typeof window.viewerHost>['domainAvailable']>
>[number];
export type DomainProgress = {
  domain?: string;
  label: string;
  phase: string;
  active?: boolean;
  received?: number;
  total?: number;
};

export function PacksSection({
  status,
  statusError,
  progress,
  busy,
  onChanged,
  onRefresh,
}: {
  status?: DomainStatus;
  statusError: string;
  progress: DomainProgress | null;
  busy: boolean;
  onChanged: (installed: DomainOption[]) => void;
  onRefresh: () => void;
}) {
  const { t } = useDisplayText();
  const [available, setAvailable] = useState<AvailablePack[]>([]);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [feedError, setFeedError] = useState('');
  useEffect(() => {
    if (!status?.managed) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setFeedError('');
    void window
      .viewerHost!.domainAvailable()
      .then(items => {
        if (!cancelled) setAvailable(items);
      })
      .catch(reason => {
        if (!cancelled) {
          setFeedError(String(reason));
          setAvailable([]);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [status?.managed, status?.catalogWarning, progress === null]);
  async function install(domain: string) {
    if (busy || pending || progress) return;
    setPending(true);
    setError('');
    try {
      const result = await window.viewerHost!.domainInstall([domain]);
      onChanged(result.installed);
    } catch (reason) {
      setError(String(reason));
      onRefresh();
    } finally {
      setPending(false);
    }
  }
  async function remove(domain: string) {
    if (busy || pending || progress) return;
    setPending(true);
    setError('');
    try {
      const result = await window.viewerHost!.domainRemove(domain);
      onChanged(result.installed);
    } catch (reason) {
      setError(String(reason));
    } finally {
      setPending(false);
    }
  }
  async function repair(domain: string) {
    if (busy || pending || progress) return;
    setPending(true);
    setError('');
    try {
      const result = await window.viewerHost!.domainRepair(domain);
      onChanged(result.installed);
    } catch (reason) {
      setError(String(reason));
    } finally {
      setPending(false);
    }
  }
  const installed = status?.installed || [];
  const installedIds = new Set(installed.map(item => item.domain));
  const installable = available.filter(item => !installedIds.has(item.domain));
  const updateFor = (domain: string) => available.find(item => item.domain === domain);
  const diagnosticsFor = (domain: string) =>
    (status?.errors || []).filter(item => item.domain === domain);
  const disabled = busy || pending || Boolean(progress);
  return (
    <section className="ia-capability-section" aria-label={t('Domain packs')}>
      <h2>{t('Domain packs')}</h2>
      <p>{t('Each pack bundles the skills, MCP servers and runtime for one domain.')}</p>
      {statusError && (
        <p role="alert" className="ia-project-error">
          {t(statusError)}
        </p>
      )}
      {error && (
        <p role="alert" className="ia-project-error">
          {t(error)}
        </p>
      )}
      {feedError && (
        <p role="alert" className="ia-project-error">
          {t('Catalog unavailable:')} {feedError}
        </p>
      )}
      {status?.catalogWarning && (
        <p role="status" className="ia-capability-note">
          {t('Updates unavailable. Bundled domains can still be installed.')}
        </p>
      )}
      {progress && (
        <div className="ia-domain-progress" role="status">
          <span>
            {progress.label} ·{' '}
            {t(
              (
                {
                  downloading: 'Downloading…',
                  installing: 'Preparing…',
                  checking: 'Checking…',
                  ready: 'Ready to use',
                } as Record<string, string>
              )[progress.phase] || 'Preparing…',
            )}
          </span>
          <button
            type="button"
            onClick={() =>
              void window.viewerHost!.domainCancel().catch(reason => setError(String(reason)))
            }
          >
            {t('Cancel download')}
          </button>
          {progress.phase === 'downloading' && (
            <>
              <progress max={progress.total} value={progress.received} />
              <small>
                {((progress.received || 0) / 1024 / 1024).toFixed(0)} /{' '}
                {((progress.total || 0) / 1024 / 1024).toFixed(0)} MB
              </small>
            </>
          )}
        </div>
      )}
      {busy && <p role="status">{t('Finish the current task before changing domains.')}</p>}
      {!status?.managed && !statusError && (
        <p className="ia-capability-note">
          {t(
            'Domain installation is available in packaged builds. Development resources are loaded from this repository.',
          )}
        </p>
      )}
      {status?.managed && (
        <>
          {installable.length > 0 && (
            <>
              <h3>
                {t('Available')} · {installable.length}
              </h3>
              <div className="ia-pack-grid">
                {installable.map(item => (
                  <div key={item.domain} className="ia-pack-card">
                    <span className="ia-pack-icon" aria-hidden="true">
                      {item.emoji || '⚙️'}
                    </span>
                    <div className="ia-pack-body">
                      <div className="ia-pack-title">
                        <b>{item.label || item.domain}</b>
                        <small>v{item.version}</small>
                      </div>
                      {item.summary && <p className="ia-pack-summary">{t(item.summary)}</p>}
                      <small className="ia-pack-meta">
                        {((item.size + (item.runtimeDownloadSize || 0)) / 1024 / 1024).toFixed(0)}{' '}
                        {t('MB download')}
                        {item.prerequisites?.length
                          ? ` · ${t('Needs:')} ${item.prerequisites.map(text => t(text)).join('; ')}`
                          : ''}
                      </small>
                    </div>
                    <button
                      className="ia-pack-action"
                      disabled={disabled || loading}
                      onClick={() => void install(item.domain)}
                    >
                      {t('Install')}
                    </button>
                  </div>
                ))}
              </div>
            </>
          )}
          {!loading && !installable.length && !feedError && (
            <p>{t('All available domains are installed and up to date.')}</p>
          )}
          {installed.length > 0 && (
            <>
              <h3>
                {t('Installed')} · {installed.length}
              </h3>
              <div className="ia-pack-grid">
                {installed.map(item => {
                  const update = updateFor(item.domain);
                  const problems = diagnosticsFor(item.domain);
                  return (
                    <div key={item.domain} className="ia-pack-card">
                      <span className="ia-pack-icon" aria-hidden="true">
                        {item.emoji || '⚙️'}
                      </span>
                      <div className="ia-pack-body">
                        <div className="ia-pack-title">
                          <b>{t(item.label)}</b>
                          <small>
                            {update?.updateAvailable
                              ? t('Version {0} → {1}', {
                                  '0': item.version,
                                  '1': update.version,
                                })
                              : `v${item.version}`}
                          </small>
                        </div>
                        {item.summary && <p className="ia-pack-summary">{t(item.summary)}</p>}
                        {problems.map(problem => (
                          <small key={problem.message} role="alert" className="ia-pack-error">
                            {problem.message}
                          </small>
                        ))}
                        {item.runtimeState && (
                          <small
                            className={`ia-pack-badge ${item.runtimeState === 'ready' ? 'ok' : 'warn'}`}
                          >
                            {t(
                              item.runtimeState === 'ready' ? 'Ready to use' : 'Needs preparation',
                            )}
                          </small>
                        )}
                      </div>
                      <div className="ia-pack-actions">
                        {update?.updateAvailable && (
                          <button
                            className="ia-pack-action primary"
                            disabled={disabled}
                            onClick={() => void install(item.domain)}
                          >
                            {t('Update')}
                          </button>
                        )}
                        {item.runtimeState && (
                          <button
                            className="ia-pack-action"
                            disabled={disabled}
                            onClick={() => void repair(item.domain)}
                          >
                            {t(
                              item.runtimeState === 'ready' ? 'Check / repair' : 'Prepare / retry',
                            )}
                          </button>
                        )}
                        <button
                          className="ia-pack-action"
                          disabled={disabled}
                          onClick={() => void remove(item.domain)}
                        >
                          {t('Remove')}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
}
