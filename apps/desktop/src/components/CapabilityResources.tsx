import { useDisplayText } from '@industrial-agent-harness/viewer-builtin/text';
import { useEffect, useId, useRef, useState } from 'react';
import type {
  ProjectBinding,
  ResourceMode,
  ResourceSettingsSnapshot,
} from '@industrial-agent-harness/viewer-builtin/api';
import { ExternalMcpPanel } from './ExternalMcpSettings';
import { RemoteServiceSettings } from './RemoteExecution';

export type ResourceKind = 'skills' | 'mcpServers';

function ScopeSwitch({
  project,
  scope,
  onScope,
}: {
  project?: ProjectBinding;
  scope: 'global' | 'project';
  onScope: (scope: 'global' | 'project') => void;
}) {
  const { t } = useDisplayText();
  return (
    <div className="ia-scope-switch" role="radiogroup" aria-label={t('Settings scope')}>
      <button role="radio" aria-checked={scope === 'global'} onClick={() => onScope('global')}>
        {t('Global default')}
      </button>
      <button
        role="radio"
        aria-checked={scope === 'project'}
        disabled={!project}
        title={project?.name}
        onClick={() => onScope('project')}
      >
        {project ? project.name || t('This project') : t('This project')}
      </button>
    </div>
  );
}

function SearchBox({
  value,
  onChange,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  label: string;
}) {
  const { t } = useDisplayText();
  const id = useId();
  return (
    <input
      id={id}
      className="ia-resource-search"
      type="search"
      value={value}
      placeholder={t('Search…')}
      aria-label={label}
      onChange={event => onChange(event.target.value)}
    />
  );
}

export function ResourceList({
  kind,
  projectId,
  busy,
  search = '',
  heading,
  revision = 0,
  onChanged,
}: {
  kind: ResourceKind;
  projectId?: string;
  busy: boolean;
  search?: string;
  heading?: string;
  revision?: number;
  onChanged: () => void;
}) {
  const { t } = useDisplayText();
  const [snapshot, setSnapshot] = useState<ResourceSettingsSnapshot>();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
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
  }, [projectId, kind, revision]);
  async function change(id: string, mode: ResourceMode) {
    if (lock.current) return;
    lock.current = true;
    setSaving(true);
    setError('');
    try {
      const next = await window.viewerHost!.resourceSet({
        projectId,
        kind: kind === 'skills' ? 'skill' : 'mcp',
        id,
        mode,
      });
      if (mounted.current) setSnapshot(next);
      onChanged();
    } catch (reason) {
      if (mounted.current) setError(String(reason));
    } finally {
      lock.current = false;
      if (mounted.current) setSaving(false);
    }
  }
  const query = search.trim().toLowerCase();
  const items = (snapshot?.catalog[kind] || []).filter(
    item => !query || `${item.title} ${item.id} ${item.domain}`.toLowerCase().includes(query),
  );
  const groups = new Map<string, typeof items>();
  for (const item of items) {
    const list = groups.get(item.domain) || [];
    list.push(item);
    groups.set(item.domain, list);
  }
  return (
    <section
      className="ia-project-resources"
      aria-label={heading || (kind === 'skills' ? t('Skills') : t('MCP servers'))}
    >
      {heading && <h2>{heading}</h2>}
      {busy && <p role="status">{t('Stop the current task to change resources.')}</p>}
      {error && (
        <p role="alert" className="ia-project-error">
          {t(error)}
        </p>
      )}
      {!snapshot
        ? !error && <p>{t('Loading resources…')}</p>
        : Array.from(groups.entries()).map(([domain, list]) => (
            <div key={domain}>
              <h3>
                {domain}
                <small> · {list.length}</small>
              </h3>
              {list.map(item => {
                const globalEnabled =
                  !snapshot.global[kind].includes(item.id) && item.enabledByDefault;
                const override = snapshot.overrides[kind][item.id];
                const mode = override === undefined ? 'inherit' : override ? 'enabled' : 'disabled';
                const enabled = !snapshot.effective[kind].includes(item.id);
                return (
                  <label key={item.id} data-resource-id={item.id}>
                    <span>
                      <b>{item.title}</b>
                      <small>
                        {item.id} · {enabled ? t('Enabled') : t('Disabled')}
                        {!projectId &&
                          ` · ${t('Global: {0}', { '0': t(globalEnabled ? 'Enabled' : 'Disabled') })}`}
                      </small>
                    </span>
                    {projectId ? (
                      <select
                        aria-label={t('{0} project setting', { '0': item.title })}
                        value={mode}
                        disabled={busy || saving}
                        onChange={event => void change(item.id, event.target.value as ResourceMode)}
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
                          void change(item.id, event.target.checked ? 'enabled' : 'disabled')
                        }
                      />
                    )}
                  </label>
                );
              })}
            </div>
          ))}
      {snapshot && !items.length && (
        <p>
          {kind === 'skills'
            ? t('No Skills are bundled for this domain.')
            : t('No default domain MCP servers are bundled yet.')}
        </p>
      )}
      {saving && <p role="status">{t('Saving…')}</p>}
    </section>
  );
}

export function McpSection({
  project,
  busy,
  onChanged,
}: {
  project?: ProjectBinding;
  busy: boolean;
  onChanged: () => void;
}) {
  const { t } = useDisplayText();
  const [scope, setScope] = useState<'global' | 'project'>(project ? 'global' : 'global');
  const [search, setSearch] = useState('');
  // External servers added or removed on this page must refresh the resource
  // list in place; ResourceList only refetches when its revision changes.
  const [revision, setRevision] = useState(0);
  const refresh = () => {
    setRevision(value => value + 1);
    onChanged();
  };
  return (
    <section className="ia-capability-section" aria-label={t('MCP servers')}>
      <div className="ia-capability-section-head">
        <h2>{t('MCP servers')}</h2>
        <ScopeSwitch project={project} scope={scope} onScope={setScope} />
      </div>
      <p>
        {scope === 'project'
          ? t(
              'Project overrides take priority over global defaults. Choose Inherit to follow the global setting.',
            )
          : t('Defaults for all projects. Each project can override these settings.')}{' '}
        {t('Changes apply to new sessions.')}
      </p>
      <RemoteServiceSettings />
      <SearchBox value={search} onChange={setSearch} label={t('MCP servers')} />
      <ResourceList
        kind="mcpServers"
        projectId={scope === 'project' ? project?.id : undefined}
        busy={busy}
        search={search}
        revision={revision}
        onChanged={refresh}
      />
      {scope === 'global' && <ExternalMcpPanel busy={busy} onChanged={refresh} />}
    </section>
  );
}

export function SkillsSection({
  project,
  busy,
  onChanged,
}: {
  project?: ProjectBinding;
  busy: boolean;
  onChanged: () => void;
}) {
  const { t } = useDisplayText();
  const [scope, setScope] = useState<'global' | 'project'>('global');
  const [search, setSearch] = useState('');
  return (
    <section className="ia-capability-section" aria-label={t('Skills')}>
      <div className="ia-capability-section-head">
        <h2>{t('Skills')}</h2>
        <ScopeSwitch project={project} scope={scope} onScope={setScope} />
      </div>
      <p>
        {scope === 'project'
          ? t(
              'Project overrides take priority over global defaults. Choose Inherit to follow the global setting.',
            )
          : t('Defaults for all projects. Each project can override these settings.')}{' '}
        {t('Changes apply to new sessions.')}
      </p>
      <SearchBox value={search} onChange={setSearch} label={t('Skills')} />
      <ResourceList
        kind="skills"
        projectId={scope === 'project' ? project?.id : undefined}
        busy={busy}
        search={search}
        onChanged={onChanged}
      />
    </section>
  );
}
