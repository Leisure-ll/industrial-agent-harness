import { useDisplayText } from '@industrial-agent-harness/viewer-builtin/text';
import { useEffect, useRef, useState } from 'react';
import type {
  ResourceMode,
  ResourceSettingsSnapshot,
} from '@industrial-agent-harness/viewer-builtin/api';
import { ExternalMcpSettings } from './ExternalMcpSettings';

export function ResourceSettings({
  projectId,
  busy,
  onChanged,
}: {
  projectId?: string;
  busy: boolean;
  onChanged: () => void;
}) {
  const { t } = useDisplayText();
  const [snapshot, setSnapshot] = useState<ResourceSettingsSnapshot>();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const mounted = useRef(false);
  const lock = useRef(false);
  useEffect(() => {
    mounted.current = true;
    let cancelled = false;
    void window
      .viewerHost!.resourceGet({ projectId })
      .then(value => {
        if (!cancelled) setSnapshot(value);
      })
      .catch(reason => {
        if (!cancelled) setError(String(reason));
      });
    return () => {
      cancelled = true;
      mounted.current = false;
    };
  }, [projectId, revision]);
  async function change(kind: 'skill' | 'mcp', id: string, mode: ResourceMode) {
    if (lock.current) return;
    lock.current = true;
    setSaving(true);
    setError('');
    try {
      const next = await window.viewerHost!.resourceSet({ projectId, kind, id, mode });
      if (mounted.current) setSnapshot(next);
      onChanged();
    } catch (reason) {
      if (mounted.current) setError(String(reason));
    } finally {
      lock.current = false;
      if (mounted.current) setSaving(false);
    }
  }
  return (
    <section
      className="ia-project-resources"
      aria-label={projectId ? t('Project MCP and Skills') : t('Global MCP and Skills')}
    >
      <h2>{t('MCP & Skills')}</h2>
      <p>
        {projectId
          ? t(
              'Project overrides take priority over global defaults. Choose Inherit to follow the global setting.',
            )
          : t('Defaults for all projects. Each project can override these settings.')}{' '}
        {t('Changes apply to new sessions.')}
      </p>
      {busy && <p role="status">{t('Stop the current task to change resources.')}</p>}
      {error && (
        <p role="alert" className="ia-project-error">
          {t(error)}
        </p>
      )}
      {!snapshot
        ? !error && <p>{t('Loading resources…')}</p>
        : (['skills', 'mcpServers'] as const).map(key => (
            <div key={key}>
              <h3>{key === 'skills' ? t('Skills') : t('MCP servers')}</h3>
              {!snapshot.catalog[key].length && (
                <p>
                  {key === 'skills'
                    ? t('No Skills are bundled for this domain.')
                    : t('No default domain MCP servers are bundled yet.')}
                </p>
              )}
              {snapshot.catalog[key].map(item => {
                const globalEnabled =
                  !snapshot.global[key].includes(item.id) && item.enabledByDefault;
                const override = snapshot.overrides[key][item.id];
                const mode = override === undefined ? 'inherit' : override ? 'enabled' : 'disabled';
                const enabled = !snapshot.effective[key].includes(item.id);
                return (
                  <label key={item.id} data-resource-id={item.id}>
                    <span>
                      <b>{item.title}</b>
                      <small>
                        {item.id}
                        {!projectId && ` · ${item.domain}`} ·{' '}
                        {enabled ? t('Enabled') : t('Disabled')}
                        {projectId &&
                          ` · ${t('Global: {0}', { '0': t(globalEnabled ? 'Enabled' : 'Disabled') })}`}
                      </small>
                    </span>
                    {projectId ? (
                      <select
                        aria-label={t('{0} project setting', { '0': item.title })}
                        value={mode}
                        disabled={busy || saving}
                        onChange={event =>
                          void change(
                            key === 'skills' ? 'skill' : 'mcp',
                            item.id,
                            event.target.value as ResourceMode,
                          )
                        }
                      >
                        <option value="inherit">
                          {t('Inherit ({0})', { '0': t(globalEnabled ? 'Enabled' : 'Disabled') })}
                        </option>
                        <option value="enabled">{t('Enabled')}</option>
                        <option value="disabled">{t('Disabled')}</option>
                      </select>
                    ) : (
                      <input
                        type="checkbox"
                        aria-label={t('{0} global default', { '0': item.title })}
                        checked={enabled}
                        disabled={busy || saving}
                        onChange={event =>
                          void change(
                            key === 'skills' ? 'skill' : 'mcp',
                            item.id,
                            event.target.checked ? 'enabled' : 'disabled',
                          )
                        }
                      />
                    )}
                  </label>
                );
              })}
            </div>
          ))}
      {saving && <p role="status">{t('Saving…')}</p>}
      {!projectId && (
        <ExternalMcpSettings
          busy={busy || saving}
          onChanged={() => {
            setRevision(value => value + 1);
            onChanged();
          }}
        />
      )}
    </section>
  );
}

export function GlobalResourceSettings({
  busy,
  onChanged,
  onClose,
}: {
  busy: boolean;
  onChanged: () => void;
  onClose: () => void;
}) {
  const { t } = useDisplayText();
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    dialog.current?.showModal();
    return () => {
      if (opener?.isConnected && opener !== document.body) opener.focus();
      else document.querySelector<HTMLButtonElement>('.ia-settings-button')?.focus();
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      className="ia-resource-modal"
      aria-label={t('Global MCP and Skill settings')}
      onCancel={onClose}
      onClick={event => {
        if (event.target !== event.currentTarget) return;
        const box = event.currentTarget.getBoundingClientRect();
        if (
          event.clientX < box.left ||
          event.clientX > box.right ||
          event.clientY < box.top ||
          event.clientY > box.bottom
        )
          onClose();
      }}
    >
      <header>
        <div>
          <h1>{t('Global resources')}</h1>
          <p>{t('MCP and Skill defaults')}</p>
        </div>
        <button aria-label={t('Close resource settings')} onClick={onClose}>
          ×
        </button>
      </header>
      <ResourceSettings busy={busy} onChanged={onChanged} />
    </dialog>
  );
}
