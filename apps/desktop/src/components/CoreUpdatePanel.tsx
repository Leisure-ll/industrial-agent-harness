import { useEffect, useRef, useState } from 'react';
import type { CoreUpdateState } from '@industrial-agent-harness/viewer-builtin/api';

export function CoreUpdatePanel({ busy, onClose }: { busy: boolean; onClose: () => void }) {
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
      : state?.status === 'idle'
        ? 'Check for an application update.'
        : state?.status === 'checking'
          ? 'Checking for updates…'
          : state?.status === 'current'
            ? 'The application is up to date.'
            : state?.status === 'available'
              ? `Version ${state.version} is available. Downloading…`
              : state?.status === 'downloading'
                ? `Downloading version ${state.version} · ${state.progress ?? 0}%`
                : state?.status === 'ready'
                  ? `Version ${state.version} is ready. Restart to install.`
                  : 'Unable to check for updates.';
  return (
    <dialog
      ref={dialog}
      className="ia-resource-modal ia-domains-modal"
      aria-label="Application updates"
      onCancel={onClose}
    >
      <header>
        <div>
          <h1>Application update</h1>
          <p>Core runtime and desktop application</p>
        </div>
        <button aria-label="Close application update" onClick={onClose}>
          ×
        </button>
      </header>
      <div className="ia-domains-content">
        <p role="status">{description}</p>
        {state?.error && (
          <p role="alert" className="ia-project-error">
            {state.error}
          </p>
        )}
        {error && (
          <p role="alert" className="ia-project-error">
            {error}
          </p>
        )}
        {busy && state?.status === 'ready' && <p>Finish running tasks before restarting.</p>}
        <div className="ia-domains-actions">
          <button
            onClick={() => void check()}
            disabled={
              state?.status === 'development' ||
              state?.status === 'checking' ||
              state?.status === 'downloading'
            }
          >
            Check now
          </button>
          <button onClick={onClose}>Close</button>
          {state?.status === 'ready' && (
            <button className="ia-domains-primary" onClick={() => void install()} disabled={busy}>
              Restart and install
            </button>
          )}
        </div>
      </div>
    </dialog>
  );
}
