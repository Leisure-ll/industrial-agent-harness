import { useEffect, useRef, useState } from 'react';
import type { DomainOption } from '@industrial-agent-harness/viewer-builtin/api';

type Installed = {
  domain: string;
  version: string;
  label: string;
  emoji: string;
  summary?: string;
  prerequisites?: string[];
};
type Available = {
  domain: string;
  version: string;
  label?: string;
  emoji?: string;
  summary?: string;
  prerequisites?: string[];
  size: number;
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
  const dialog = useRef<HTMLDialogElement>(null);
  const [installed, setInstalled] = useState<Installed[]>([]);
  const [available, setAvailable] = useState<Available[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [feedError, setFeedError] = useState('');
  const [managed, setManaged] = useState(false);
  const [diagnostics, setDiagnostics] = useState<Array<{ domain: string; message: string }>>([]);
  useEffect(() => {
    dialog.current?.showModal();
    void refresh();
  }, []);
  async function refresh() {
    setLoading(true);
    setFeedError('');
    try {
      const status = await window.viewerHost!.domainStatus();
      setInstalled(status.installed);
      setManaged(status.managed);
      setDiagnostics(status.errors);
      if (status.managed) onChanged(await window.viewerHost!.domains());
      if (status.managed) {
        try {
          setAvailable(await window.viewerHost!.domainAvailable());
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
    item => installedById.get(item.domain)?.version !== item.version,
  );
  return (
    <dialog
      ref={dialog}
      className="ia-resource-modal ia-domains-modal"
      aria-label="Manage domains"
      onCancel={onClose}
    >
      <header>
        <div>
          <h1>{firstRun ? 'Choose your domains' : 'Domains'}</h1>
          <p>
            {firstRun
              ? 'Select one or more domains to prepare the workspace.'
              : 'Add missing domains and install available updates.'}
          </p>
        </div>
        <button aria-label="Close domain manager" onClick={onClose}>
          ×
        </button>
      </header>
      <div className="ia-domains-content">
        {loading && <p role="status">Checking domains…</p>}
        {error && (
          <p role="alert" className="ia-project-error">
            {error}
          </p>
        )}
        {feedError && (
          <p role="alert" className="ia-project-error">
            Catalog unavailable: {feedError}
          </p>
        )}
        {diagnostics.map(item => (
          <p key={item.domain} role="alert" className="ia-project-error">
            {item.domain}: {item.message}
          </p>
        ))}
        {!managed && !loading && (
          <p>
            Domain installation is available in packaged builds. Development resources are loaded
            from this repository.
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
                    <span className="ia-domain-install-emoji" aria-hidden="true">
                      {item.emoji || current?.emoji || '⚙️'}
                    </span>
                    <span>
                      <b>{item.label || current?.label || item.domain}</b>
                      <small>
                        {current
                          ? `${current.version} → ${item.version}`
                          : `Install ${item.version}`}{' '}
                        · {(item.size / 1024 / 1024).toFixed(1)} MB download
                      </small>
                      {item.summary && <small>{item.summary}</small>}
                      {item.prerequisites?.length ? (
                        <small>Needs: {item.prerequisites.join('; ')}</small>
                      ) : null}
                    </span>
                  </label>
                );
              })}
            </div>
            {!loading && !selectable.length && !feedError && (
              <p>All available domains are installed and up to date.</p>
            )}
            {installed.length > 0 && (
              <div className="ia-domains-installed">
                <h2>Installed</h2>
                {installed.map(item => (
                  <div key={item.domain} className="ia-domains-installed-row">
                    <span>
                      {item.emoji} {item.label} · {item.version}
                    </span>
                    <button disabled={saving || busy} onClick={() => void remove(item.domain)}>
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            )}
            {busy && <p role="status">Finish the current task before changing domains.</p>}
          </>
        )}
        <div className="ia-domains-actions">
          <button onClick={() => void refresh()} disabled={loading || saving}>
            Check updates
          </button>
          <button onClick={onClose}>{firstRun ? 'Skip for now' : 'Close'}</button>
          {managed && (
            <button
              className="ia-domains-primary"
              disabled={!selected.length || saving || busy}
              onClick={() => void install()}
            >
              {saving ? 'Installing…' : `Install ${selected.length || ''}`}
            </button>
          )}
        </div>
      </div>
    </dialog>
  );
}
