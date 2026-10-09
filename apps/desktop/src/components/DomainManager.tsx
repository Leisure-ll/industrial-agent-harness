import { DomainIcon } from '@industrial-agent-harness/viewer-builtin/domain-icon';
import { useDisplayText } from '@industrial-agent-harness/viewer-builtin/text';
import { useEffect, useRef, useState } from 'react';
import type { DomainOption } from '@industrial-agent-harness/viewer-builtin/api';

type Installed = {
  domain: string;
  version: string;
  label: string;
  emoji: string;
  summary?: string;
  prerequisites?: string[];
  runtimeState?: 'ready' | 'needs-preparation' | null;
};
type Available = {
  domain: string;
  version: string;
  label?: string;
  emoji?: string;
  summary?: string;
  prerequisites?: string[];
  size: number;
  runtimeDownloadSize?: number;
  updateAvailable?: boolean;
  platforms: string[];
};

export function DomainManager({
  onClose,
  onChanged,
  firstRun,
  busy,
}: {
  onClose: () => void;
  onChanged: (domains: DomainOption[]) => void;
  firstRun: boolean;
  busy: boolean;
}) {
  const { t } = useDisplayText();
  const dialog = useRef<HTMLDialogElement>(null);
  const [installed, setInstalled] = useState<Installed[]>([]);
  const [available, setAvailable] = useState<Available[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [feedError, setFeedError] = useState('');
  const [updateWarning, setUpdateWarning] = useState(false);
  const [managed, setManaged] = useState(false);
  const [diagnostics, setDiagnostics] = useState<Array<{ domain: string; message: string }>>([]);
  const [progress, setProgress] = useState<{
    label: string;
    phase: string;
    received?: number;
    total?: number;
  } | null>(null);
  useEffect(() => {
    dialog.current?.showModal();
    void refresh();
    return window.viewerHost!.onDomainProgress(progress => {
      if (progress.active === false) {
        setSaving(false);
        setProgress(null);
        void refresh();
      } else setProgress(progress);
    });
  }, []);
  async function refresh() {
    setLoading(true);
    setFeedError('');
    setUpdateWarning(false);
    try {
      const status = await window.viewerHost!.domainStatus();
      setInstalled(status.installed);
      setSaving(Boolean(status.operation?.active));
      if (status.operation?.progress) setProgress(status.operation.progress);
      setManaged(status.managed);
      setDiagnostics(status.errors);
      if (status.managed) onChanged(await window.viewerHost!.domains());
      if (status.managed) {
        try {
          setAvailable(await window.viewerHost!.domainAvailable());
          setUpdateWarning(Boolean((await window.viewerHost!.domainStatus()).catalogWarning));
        } catch (reason) {
          setFeedError(String(reason));
          setAvailable([]);
        }
      }
    } catch (reason) {
      setError(String(reason));
    } finally {
      setLoading(false);
    }
  }
  async function install() {
    if (!selected.length || busy || saving) return;
    setSaving(true);
    setProgress(null);
    setError('');
    try {
      const result = await window.viewerHost!.domainInstall(selected);
      onChanged(result.installed);
      setSelected([]);
      await refresh();
      if (firstRun) onClose();
    } catch (reason) {
      setError(String(reason));
      await refresh();
    } finally {
      setSaving(false);
      setProgress(null);
    }
  }
  async function repair(domain: string) {
    if (busy || saving) return;
    setSaving(true);
    setError('');
    setProgress(null);
    try {
      const result = await window.viewerHost!.domainRepair(domain);
      onChanged(result.installed);
    } catch (reason) {
      setError(String(reason));
    } finally {
      await refresh();
      setSaving(false);
      setProgress(null);
    }
  }
  async function remove(domain: string) {
    if (busy || saving) return;
    setSaving(true);
    setError('');
    try {
      const result = await window.viewerHost!.domainRemove(domain);
      onChanged(result.installed);
      await refresh();
    } catch (reason) {
      setError(String(reason));
    } finally {
      setSaving(false);
    }
  }
  function toggle(domain: string) {
    setSelected(current =>
      current.includes(domain) ? current.filter(id => id !== domain) : [...current, domain],
    );
  }
  const installedById = new Map(installed.map(item => [item.domain, item]));
  const selectable = available.filter(
    item => !installedById.has(item.domain) || item.updateAvailable === true,
  );
  async function close() {
    if (saving) await window.viewerHost!.domainCancel();
    onClose();
  }
  return (
    <dialog
      ref={dialog}
      className="ia-resource-modal ia-domains-modal"
      aria-label={t('Manage domains')}
      onCancel={event => {
        event.preventDefault();
        void close().catch(reason => setError(String(reason)));
      }}
    >
      <header>
        <div>
          <h1>{firstRun ? t('Choose your domains') : t('Domains')}</h1>
          <p>
            {firstRun
              ? t('Select one or more domains to prepare the workspace.')
              : t('Add missing domains and install available updates.')}
          </p>
        </div>
        <button
          aria-label={t('Close domain manager')}
          onClick={() => void close().catch(reason => setError(String(reason)))}
        >
          ×
        </button>
      </header>
      <div className="ia-domains-content">
        {loading && <p role="status">{t('Checking domains…')}</p>}
        {updateWarning && (
          <p role="status">{t('Updates unavailable. Bundled domains can still be installed.')}</p>
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
            {saving && (
              <button
                type="button"
                onClick={() =>
                  void window.viewerHost!.domainCancel().catch(reason => setError(String(reason)))
                }
              >
                {t('Cancel download')}
              </button>
            )}
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
        {diagnostics.map(item => (
          <p key={item.domain} role="alert" className="ia-project-error">
            {item.domain}: {item.message}
          </p>
        ))}
        {!managed && !loading && (
          <p>
            {t(
              'Domain installation is available in packaged builds. Development resources are loaded from this repository.',
            )}
          </p>
        )}
        {managed && (
          <>
            <div className="ia-domains-list">
              {selectable.map(item => {
                const current = installedById.get(item.domain);
                return (
                  <label key={item.domain} className="ia-domain-install-row">
                    <input
                      type="checkbox"
                      checked={selected.includes(item.domain)}
                      disabled={saving || busy}
                      onChange={() => toggle(item.domain)}
                    />
                    <DomainIcon domain={item.domain} size={22} />
                    <span>
                      <b>{item.label || current?.label || item.domain}</b>
                      <small>
                        {current
                          ? `${current.version} → ${item.version}`
                          : t('Install {0}', { '0': item.version })}{' '}
                        · {((item.size + (item.runtimeDownloadSize || 0)) / 1024 / 1024).toFixed(0)}{' '}
                        {t('MB download')}
                      </small>
                      {item.summary && <small>{t(item.summary)}</small>}
                      {item.prerequisites?.length ? (
                        <small>
                          {t('Needs:')} {item.prerequisites.map(text => t(text)).join('; ')}
                        </small>
                      ) : null}
                    </span>
                  </label>
                );
              })}
            </div>
            {!loading && !selectable.length && !feedError && (
              <p>{t('All available domains are installed and up to date.')}</p>
            )}
            {installed.length > 0 && (
              <div className="ia-domains-installed">
                <h2>{t('Installed')}</h2>
                {installed.map(item => (
                  <div key={item.domain} className="ia-domains-installed-row">
                    <span>
                      <DomainIcon domain={item.domain} /> {t(item.label)} · {item.version}
                      {item.runtimeState && (
                        <small className="ia-domain-readiness">
                          {t(item.runtimeState === 'ready' ? 'Ready to use' : 'Needs preparation')}
                        </small>
                      )}
                    </span>
                    {item.runtimeState && (
                      <button disabled={saving || busy} onClick={() => void repair(item.domain)}>
                        {t(item.runtimeState === 'ready' ? 'Check / repair' : 'Prepare / retry')}
                      </button>
                    )}
                    <button disabled={saving || busy} onClick={() => void remove(item.domain)}>
                      {t('Remove')}
                    </button>
                  </div>
                ))}
              </div>
            )}
            {busy && <p role="status">{t('Finish the current task before changing domains.')}</p>}
          </>
        )}
        <div className="ia-domains-actions">
          <button onClick={() => void refresh()} disabled={loading || saving}>
            {t('Check updates')}
          </button>
          <button onClick={() => void close().catch(reason => setError(String(reason)))}>
            {firstRun ? t('Skip for now') : t('Close')}
          </button>
          {managed && (
            <button
              className="ia-domains-primary"
              disabled={!selected.length || saving || busy}
              onClick={() => void install()}
            >
              {saving ? t('Installing…') : t('Install {0}', { '0': selected.length || '' })}
            </button>
          )}
        </div>
      </div>
    </dialog>
  );
}
