import { Minus, Square, X } from 'lucide-react';
import { useDisplayText } from '@industrial-agent-harness/viewer-builtin/text';

// In-page window controls for frameless windows on platforms without native
// traffic lights (macOS keeps its own).
export function WindowControls() {
  const { t } = useDisplayText();
  if (window.viewerHost?.platform !== 'darwin' && window.viewerHost?.platform !== undefined)
    return (
      <div className="ia-window-controls">
        <button
          className="ia-window-control"
          onClick={() => window.viewerHost!.window.minimize()}
          aria-label={t('Minimize window')}
          title={t('Minimize window')}
        >
          <Minus size={14} />
        </button>
        <button
          className="ia-window-control"
          onClick={() => window.viewerHost!.window.toggleMaximize()}
          aria-label={t('Toggle window size')}
          title={t('Toggle window size')}
        >
          <Square size={11} />
        </button>
        <button
          className="ia-window-control close"
          onClick={() => window.viewerHost!.window.close()}
          aria-label={t('Close window')}
          title={t('Close window')}
        >
          <X size={15} />
        </button>
      </div>
    );
  return null;
}
