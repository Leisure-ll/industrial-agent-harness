import { useEffect, useRef } from 'react';
import { File, MessageCircle, Plus, Pin, X } from 'lucide-react';
import { useDisplayText } from '@industrial-agent-harness/viewer-builtin/text';

export type WorkbenchTab = {
  id: string;
  title: string;
  chat?: boolean;
  status?: string;
  preview?: boolean;
};

export function WorkspaceTabs({
  tabs,
  selected,
  onSelect,
  onClose,
  onPin,
  onAdd,
}: {
  tabs: WorkbenchTab[];
  selected: string;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onPin: (id: string) => void;
  onAdd: () => void;
}) {
  const { t } = useDisplayText();
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    list.current
      ?.querySelector<HTMLElement>('[aria-selected="true"]')
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [selected]);
  function close(id: string) {
    const restoreFocus = list.current?.contains(document.activeElement);
    onClose(id);
    if (restoreFocus)
      requestAnimationFrame(() =>
        list.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.focus(),
      );
  }
  return (
    <div className="ia-tabs">
      <div ref={list} className="ia-tab-list" role="tablist" aria-label={t('Workspace tabs')}>
        {tabs.map((tab, index) => (
          <div className={`ia-tab-item ${tab.preview ? 'ia-tab-preview' : ''}`} key={tab.id}>
            <button
              role="tab"
              id={`tab-${tab.id}`}
              aria-controls={tab.chat ? 'ia-chat-panel' : 'ia-workspace-panel'}
              aria-selected={selected === tab.id}
              tabIndex={selected === tab.id ? 0 : -1}
              title={tab.preview ? t('Double-click to keep {0}', { 0: tab.title }) : tab.title}
              onClick={() => onSelect(tab.id)}
              onDoubleClick={() => onPin(tab.id)}
              onKeyDown={event => {
                const next =
                  event.key === 'ArrowRight'
                    ? (index + 1) % tabs.length
                    : event.key === 'ArrowLeft'
                      ? (index + tabs.length - 1) % tabs.length
                      : event.key === 'Home'
                        ? 0
                        : event.key === 'End'
                          ? tabs.length - 1
                          : undefined;
                if (next !== undefined) {
                  event.preventDefault();
                  onSelect(tabs[next].id);
                  list.current?.querySelectorAll<HTMLElement>('[role="tab"]')[next]?.focus();
                } else if (event.key === 'Delete' && !tab.chat) {
                  event.preventDefault();
                  close(tab.id);
                }
              }}
            >
              {tab.chat ? <MessageCircle size={16} /> : <File size={15} />}
              <span>{tab.title}</span>
              {tab.status && (
                <small
                  className="ia-tab-status"
                  role="status"
                  aria-label={tab.status}
                  title={tab.status}
                />
              )}
            </button>
            {tab.preview && (
              <button
                className="ia-tab-pin"
                aria-label={t('Keep tab {0}', { 0: tab.title })}
                title={t('Keep tab')}
                onClick={() => onPin(tab.id)}
              >
                <Pin size={13} />
              </button>
            )}
            {!tab.chat && (
              <button
                className="ia-tab-close"
                aria-label={t('Close tab {0}', { '0': tab.title })}
                title={t('Close file')}
                onClick={() => close(tab.id)}
              >
                <X size={13} />
              </button>
            )}
          </div>
        ))}
      </div>
      <button
        className="ia-tab-add ia-icon"
        title={t('Open project files')}
        aria-label={t('Open project files')}
        onClick={onAdd}
      >
        <Plus size={17} />
      </button>
    </div>
  );
}
