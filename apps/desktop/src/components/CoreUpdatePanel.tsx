import { useDisplayText } from '@industrial-agent-harness/viewer-builtin/text';
import { useEffect, useRef, useState } from 'react';
import type { CoreUpdateState } from '@industrial-agent-harness/viewer-builtin/api';

export function CoreUpdatePanel({ busy, onClose }: { busy: boolean; onClose: () => void }) {
  const { t } = useDisplayText();
  const dialog = useRef<HTMLDialogElement>(null);
  const [state, setState] = useState<CoreUpdateState>();
  const [error, setError] = useState('');
  useEffect(() => {
    dialog.current?.showModal();
    void window
      .viewerHost!.coreUpdateStatus()
      .then(setState)
      .catch(reason => setError(String(reason)));
    return window.viewerHost!.onCoreUpdateChanged(setState);
  }, []);
  async function check() {
    setError('');
    try {
      setState(await window.viewerHost!.coreUpdateCheck());
    } catch (reason) {
      setError(String(reason));
    }
  }
  async function install() {
    setError('');
    try {
      await window.viewerHost!.coreUpdateInstall();
    } catch (reason) {
      setError(String(reason));
    }
  }
  const description =
    state?.status === 'development'
      ? 'Application updates are available in installed builds.'
      : state?.status === 'unconfigured'
        ? 'Application updates are not configured for this local build.'
        : state?.status === 'idle'
          ? 'Check for an application update.'
          : state?.status === 'checking'
            ? 'Checking for updates…'
            : state?.status === 'current'
              ? 'The application is up to date.'
              : state?.status === 'available'
                ? t('Version {0} is available. Downloading…', { 0: state.version ?? '—' })
                : state?.status === 'downloading'
                  ? t('Downloading version {0} · {1}%', {
                      0: state.version ?? '—',
                      1: state.progress ?? 0,
                    })
                  : state?.status === 'ready'
                    ? t('Version {0} is ready. Restart to install.', { 0: state.version ?? '—' })
                    : 'Unable to check for updates.';
  return (
    <dialog
      ref={dialog}
      className="ia-resource-modal ia-domains-modal"
      aria-label={t('Application updates')}
      onCancel={onClose}
    >
      <header>
        <div>
          <h1>{t('Application update')}</h1>
          <p>{t('Core runtime and desktop application')}</p>
        </div>
        <button aria-label={t('Close application update')} onClick={onClose}>
          ×
        </button>
      </header>
      <div className="ia-domains-content">
        <p role="status">{t(description)}</p>
        {state?.error && (
          <p role="alert" className="ia-project-error">
            {state.error}
          </p>
        )}
        {error && (
          <p role="alert" className="ia-project-error">
            {t(error)}
          </p>
        )}
        {busy && state?.status === 'ready' && <p>{t('Finish running tasks before restarting.')}</p>}
        <div className="ia-domains-actions">
          <button
            onClick={() => void check()}
            disabled={
              state?.status === 'development' ||
              state?.status === 'unconfigured' ||
              state?.status === 'checking' ||
              state?.status === 'downloading'
            }
          >
            {t('Check now')}
          </button>
          <button onClick={onClose}>{t('Close')}</button>
          {state?.status === 'ready' && (
            <button className="ia-domains-primary" onClick={() => void install()} disabled={busy}>
              {t('Restart and install')}
            </button>
          )}
        </div>
      </div>
    </dialog>
  );
}
