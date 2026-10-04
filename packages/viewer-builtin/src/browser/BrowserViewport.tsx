import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Globe, Plus, RotateCw, Square, X } from 'lucide-react';
import type { BrowserData, BrowserSnapshot } from '../api';
import { useViewNavigation, ViewNavigationContext, type ViewNavigation } from '../navigation';

export function BrowserWorkspace({
  onNavigation,
  ...props
}: {
  projectId: string;
  visible?: boolean;
  onReady: () => void;
  onNavigation: (value: ViewNavigation | null) => void;
}) {
  return (
    <ViewNavigationContext value={onNavigation}>
      <BrowserViewport {...props} />
    </ViewNavigationContext>
  );
}

export function BrowserViewport({
  data,
  projectId = data?.projectId || '',
  visible = true,
  onReady,
}: {
  data?: BrowserData;
  projectId?: string;
  visible?: boolean;
  onReady: () => void;
}) {
  const [state, setState] = useState<BrowserSnapshot>();
  const [address, setAddress] = useState('');
  const [error, setError] = useState('');
  const addressInput = useRef<HTMLInputElement>(null);
  const canvas = useRef<HTMLDivElement>(null);
  const [ownerId] = useState(() => crypto.randomUUID());
  const active = state?.tabs.find(tab => tab.id === state.activeId);
  const ready = Boolean(active && !active.loading && !active.error);
  const apply = useCallback(
    (snapshot: BrowserSnapshot) => {
      if (snapshot.projectId === projectId)
        setState(current => (current && current.revision > snapshot.revision ? current : snapshot));
    },
    [projectId],
  );

  useEffect(() => {
    const host = window.viewerHost!;
    let cancelled = false;
    setState(undefined);
    setError('');
    const unsubscribe = host.onBrowserChanged(snapshot => {
      if (!cancelled) apply(snapshot);
    });
    const shortcuts = host.onBrowserShortcut(event => {
      if (event.projectId !== projectId) return;
      if (event.action === 'address') {
        addressInput.current?.focus();
        addressInput.current?.select();
      }
      if (event.action === 'escape' && document.fullscreenElement) void document.exitFullscreen();
    });
    void (
      data?.url
        ? host.browserOpen({ projectId, url: data.url, reuse: true })
        : host
            .browserState({ projectId })
            .then(snapshot => (snapshot.tabs.length ? snapshot : host.browserOpen({ projectId })))
    )
      .then(snapshot => {
        if (!cancelled) apply(snapshot);
      })
      .catch(reason => {
        if (!cancelled) setError(String(reason));
      });
    return () => {
      cancelled = true;
      unsubscribe();
      shortcuts();
      void host.browserPresent({ projectId, ownerId, bounds: null }).catch(() => {});
    };
  }, [projectId, data?.url, ownerId, apply]);
  useEffect(() => {
    setAddress(active?.url === 'about:blank' ? '' : active?.url || '');
  }, [active?.id, active?.url]);
  useEffect(() => {
    if (ready) onReady();
  }, [ready, onReady]);

  useEffect(() => {
    const host = window.viewerHost!;
    let frame = 0;
    const present = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const rect = canvas.current?.getBoundingClientRect();
        const bounds =
          visible && active && active.url !== 'about:blank' && !active.error && rect
            ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
            : null;
        void host
          .browserPresent({ projectId, ownerId, bounds })
          .catch(reason => setError(String(reason)));
      });
    };
    const observer = new ResizeObserver(present);
    if (canvas.current) observer.observe(canvas.current);
    window.addEventListener('resize', present);
    document.addEventListener('fullscreenchange', present);
    present();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener('resize', present);
      document.removeEventListener('fullscreenchange', present);
      void host.browserPresent({ projectId, ownerId, bounds: null }).catch(() => {});
    };
  }, [projectId, ownerId, visible, active?.id, active?.url, active?.error]);

  async function command(action: string, tabId = active?.id, url?: string) {
    if (!tabId) return;
    setError('');
    try {
      apply(await window.viewerHost!.browserCommand({ projectId, tabId, action, url }));
    } catch (reason) {
      setError(String(reason));
    }
  }
  async function newTab() {
    setError('');
    try {
      apply(await window.viewerHost!.browserOpen({ projectId }));
      addressInput.current?.focus();
    } catch (reason) {
      setError(String(reason));
    }
  }
  useViewNavigation({
    ready,
    percent: active?.zoomPercent || 100,
    zoomIn: () => void command('zoom-in'),
    zoomOut: () => void command('zoom-out'),
    fit: () => void command('fit'),
  });

  return (
    <div className="rp-browser" aria-label="Built-in browser">
      <div className="rp-browser-tabs" role="tablist" aria-label="Browser tabs">
        {state?.tabs.map(tab => (
          <div
            className={`rp-browser-tab ${tab.id === state.activeId ? 'active' : ''}`}
            key={tab.id}
          >
            <button
              role="tab"
              aria-selected={tab.id === state.activeId}
              title={tab.title}
              onClick={() => void command('select', tab.id)}
            >
              <Globe size={12} />
              <span>{tab.title}</span>
            </button>
            <button
              aria-label={`Close tab ${tab.title}`}
              onClick={() => void command('close', tab.id)}
            >
              <X size={12} />
            </button>
          </div>
        ))}
        <button
          className="rp-browser-new"
          aria-label="New browser tab"
          title="New tab"
          onClick={() => void newTab()}
        >
          <Plus size={14} />
        </button>
      </div>
      <form
        className="rp-browser-toolbar"
        onSubmit={event => {
          event.preventDefault();
          if (active) void command('navigate', active.id, address);
          else
            void window
              .viewerHost!.browserOpen({ projectId, url: address })
              .then(apply)
              .catch(reason => setError(String(reason)));
        }}
      >
        <button
          type="button"
          aria-label="Browser back"
          title="Back"
          disabled={!active?.canGoBack}
          onClick={() => void command('back')}
        >
          <ArrowLeft size={15} />
        </button>
        <button
          type="button"
          aria-label="Browser forward"
          title="Forward"
          disabled={!active?.canGoForward}
          onClick={() => void command('forward')}
        >
          <ArrowRight size={15} />
        </button>
        <button
          type="button"
          aria-label={active?.loading ? 'Stop loading page' : 'Reload page'}
          title={active?.loading ? 'Stop' : 'Reload'}
          disabled={!active}
          onClick={() => void command(active?.loading ? 'stop' : 'reload')}
        >
          {active?.loading ? <Square size={13} /> : <RotateCw size={14} />}
        </button>
        <input
          ref={addressInput}
          aria-label="Browser address"
          placeholder="Enter a URL or localhost address"
          value={address}
          onChange={event => setAddress(event.target.value)}
          onFocus={event => event.target.select()}
          spellCheck={false}
        />
        <button type="submit" aria-label="Open address">
          Go
        </button>
      </form>
      {error && (
        <div className="rp-browser-error" role="alert">
          {error}
        </div>
      )}
      <div ref={canvas} className="rp-browser-surface">
        {active?.error ? (
          <div className="rp-browser-empty" role="alert">
            <p>{active.error}</p>
            <button onClick={() => void command('reload')}>Try again</button>
          </div>
        ) : !active || active.url === 'about:blank' ? (
          <div className="rp-browser-empty">
            <Globe size={28} />
            <h3>Open a web page</h3>
            <p>
              Enter a website or localhost address above, or open an HTML file from this project.
            </p>
          </div>
        ) : active.loading ? (
          <p className="rp-browser-loading" role="status">
            Loading page…
          </p>
        ) : null}
      </div>
      <div className="rp-browser-status" role="status">
        {active?.loading
          ? 'Loading…'
          : active?.error
            ? 'Unable to load page'
            : active?.url.startsWith('harness-browser:')
              ? 'Project HTML preview'
              : 'Browser'}{' '}
        · {active?.zoomPercent || 100}%
      </div>
    </div>
  );
}
