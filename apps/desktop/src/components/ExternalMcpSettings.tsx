import { useDisplayText } from '@industrial-agent-harness/viewer-builtin/text';
import { useEffect, useId, useRef, useState } from 'react';
import type { ExternalMcpSummary } from '@industrial-agent-harness/viewer-builtin/api';

export function ExternalMcpSettings({ busy, onChanged }: { busy: boolean; onChanged: () => void }) {
  const { t } = useDisplayText();
  const [servers, setServers] = useState<ExternalMcpSummary[]>();
  const [connection, setConnection] = useState('stdio');
  const [name, setName] = useState('');
  const [command, setCommand] = useState('');
  const [argumentsText, setArgumentsText] = useState('');
  const [url, setUrl] = useState('');
  const [configuration, setConfiguration] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const alive = useRef(false),
    lock = useRef(false),
    field = useId();
  useEffect(() => {
    alive.current = true;
    let cancelled = false;
    void window
      .viewerHost!.externalMcpList()
      .then(result => {
        if (!cancelled) setServers(result);
      })
      .catch(reason => {
        if (!cancelled) setError(String(reason));
      });
    return () => {
      cancelled = true;
      alive.current = false;
    };
  }, []);
  async function change(
    operation: () => Promise<ExternalMcpSummary[]>,
    success: string,
    clear = false,
  ) {
    if (lock.current || busy) return;
    lock.current = true;
    setPending(true);
    setError('');
    setMessage('');
    try {
      const next = await operation();
      if (!alive.current) return;
      setServers(next);
      setMessage(success);
      if (clear) {
        setName('');
        setCommand('');
        setArgumentsText('');
        setUrl('');
        setConfiguration('');
      }
      onChanged();
    } catch (reason) {
      if (alive.current) setError(String(reason));
    } finally {
      lock.current = false;
      if (alive.current) setPending(false);
    }
  }
  function add() {
    const value =
      connection === 'import'
        ? configuration
        : JSON.stringify({
            mcpServers: {
              [name]:
                connection === 'stdio'
                  ? {
                      command,
                      args: argumentsText
                        .split('\n')
                        .map(line => line.trim())
                        .filter(Boolean),
                    }
                  : { url },
            },
          });
    void change(
      () => window.viewerHost!.externalMcpAdd({ configuration: value }),
      'Service added. It is now available in every domain; project settings can disable it.',
      true,
    );
  }
  const disabled = busy || pending;
  return (
    <section className="ia-external-mcp" aria-label={t('External MCP services')}>
      <h3>{t('External MCP services')}</h3>
      <p>
        {t(
          'Shared by Desktop and all domain CLI packages. Add a service you trust: local commands start programs, and computer-use services may control apps outside this project.',
        )}
      </p>
      {error && (
        <p role="alert" className="ia-project-error">
          {t(error)}
        </p>
      )}
      {message && <p role="status">{t(message)}</p>}
      {!servers && !error && <p>{t('Loading external services…')}</p>}
      {servers?.map(server => (
        <div className="ia-external-server" key={server.id}>
          <div>
            <b>{server.title}</b>
            <small>
              {server.id} · {server.transport === 'stdio' ? t('Local') : t('Remote')} ·{' '}
              {server.toolCount} {t('tools')}
            </small>
          </div>
          <div className="ia-external-actions">
            <button
              disabled={disabled}
              onClick={() =>
                void change(
                  () => window.viewerHost!.externalMcpRefresh(server.id),
                  'Tool snapshot refreshed. The next task will use a new scope.',
                )
              }
              aria-label={t('Refresh {0} tools', { '0': server.title })}
            >
              {t('Refresh tools')}
            </button>
            <button
              disabled={disabled}
              onClick={() =>
                void change(
                  () => window.viewerHost!.externalMcpRemove(server.id),
                  'Service removed from future tasks.',
                )
              }
              aria-label={t('Remove {0}', { '0': server.title })}
            >
              {t('Remove')}
            </button>
          </div>
        </div>
      ))}
      <form
        onSubmit={event => {
          event.preventDefault();
          add();
        }}
      >
        <h4>{t('Add an MCP service')}</h4>
        <label htmlFor={`${field}-connection`}>{t('Connection')}</label>
        <select
          id={`${field}-connection`}
          value={connection}
          disabled={disabled}
          onChange={event => setConnection(event.target.value)}
        >
          <option value="stdio">{t('Local command')}</option>
          <option value="http">{t('Remote URL')}</option>
          <option value="import">{t('Import configuration')}</option>
        </select>
        {connection === 'import' ? (
          <>
            <label htmlFor={`${field}-configuration`}>{t('MCP configuration JSON')}</label>
            <textarea
              id={`${field}-configuration`}
              required
              value={configuration}
              disabled={disabled}
              onChange={event => setConfiguration(event.target.value)}
              placeholder={'{"mcpServers":{"computer-use":{"command":"…","args":[]}}}'}
            />
          </>
        ) : (
          <>
            <label htmlFor={`${field}-name`}>{t('Name')}</label>
            <input
              id={`${field}-name`}
              required
              value={name}
              disabled={disabled}
              onChange={event => setName(event.target.value)}
              placeholder="computer-use"
              pattern="[A-Za-z0-9][A-Za-z0-9_.\-]{0,63}"
            />
            {connection === 'stdio' ? (
              <>
                <label htmlFor={`${field}-command`}>{t('Command')}</label>
                <input
                  id={`${field}-command`}
                  required
                  value={command}
                  disabled={disabled}
                  onChange={event => setCommand(event.target.value)}
                  placeholder={t('Absolute executable path or installed command')}
                />
                <label htmlFor={`${field}-arguments`}>{t('Arguments, one per line')}</label>
                <textarea
                  id={`${field}-arguments`}
                  value={argumentsText}
                  disabled={disabled}
                  onChange={event => setArgumentsText(event.target.value)}
                />
              </>
            ) : (
              <>
                <label htmlFor={`${field}-url`}>{t('Service URL')}</label>
                <input
                  id={`${field}-url`}
                  type="url"
                  required
                  value={url}
                  disabled={disabled}
                  onChange={event => setUrl(event.target.value)}
                  placeholder="https://example.com/mcp"
                />
              </>
            )}
          </>
        )}
        <p>
          {t(
            'Use Import configuration for environment variables, authentication headers or legacy SSE connections. Adding or refreshing connects to the service to check its tools.',
          )}
        </p>
        <button type="submit" disabled={disabled || !servers}>
          {pending ? t('Checking service…') : t('Add and check')}
        </button>
      </form>
    </section>
  );
}
