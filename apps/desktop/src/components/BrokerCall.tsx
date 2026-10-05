import { useDisplayText } from '@industrial-agent-harness/viewer-builtin/text';
import type { BrokerResult, CapabilityDetail } from '@industrial-agent-harness/viewer-builtin/api';

export function BrokerCall({
  broker,
  detail,
  debug,
  selectedDomain,
  onContext,
  onDetail,
  readOnly = false,
}: {
  broker: BrokerResult;
  detail?: CapabilityDetail;
  readOnly?: boolean;
  debug: boolean;
  selectedDomain: string | null;
  onContext: (context: { domain: string; stage: string }) => void;
  onDetail: (id: string) => void;
}) {
  const { t } = useDisplayText();
  const { scope, matches } = broker;
  return (
    <details className="ia-agent-tool ia-broker-tool">
      <summary>
        {t('Capability Broker ·')} {scope.domain || t('Auto')}
        {scope.stage ? ` / ${scope.stage}` : ''} · {matches.length}{' '}
        {matches.length === 1 ? t('capability') : t('capabilities')}
      </summary>
      <div className="ia-tool-detail">
        <small>
          {t('Scope')} {scope.version.slice(0, 8)}
        </small>
        <div className="ia-broker-context">
          <span>{t('Context')}</span>
          <div>
            {broker.contexts
              .filter(context => !selectedDomain || context.domain === selectedDomain)
              .map(context => (
                <button
                  key={`${context.domain}:${context.stage}`}
                  disabled={readOnly}
                  onClick={() => onContext(context)}
                >
                  {context.domain} / {context.stage}
                </button>
              ))}
          </div>
        </div>
        {matches.length ? (
          <>
            <small>{t('Selected capabilities')}</small>
            {matches.map(item => (
              <button
                className="ia-broker-capability"
                key={item.id}
                disabled={readOnly}
                onClick={() => onDetail(item.id)}
              >
                <b>{item.title}</b>
                <span>{item.id}</span>
              </button>
            ))}
            <small>
              {scope.skills.length} {t('skills ·')} {scope.tools.length} {t('tools')}
            </small>
          </>
        ) : (
          <p>
            {t('No domain capability selected. Kimi can continue with its standard project tools.')}
          </p>
        )}
        {detail && (
          <div className="ia-broker-detail">
            <b>L3 · {detail.capability}</b>
            {detail.skills.map(item => (
              <p key={item.id}>
                <b>{item.id}</b>
                <br />
                {item.reference}
              </p>
            ))}
            {detail.tools.map(item => (
              <p key={item.id}>
                <b>{item.id}</b> · {JSON.stringify(item.schema)}
              </p>
            ))}
          </div>
        )}
        {debug && (
          <div className="ia-broker-trace">
            <small>{t('Disclosure log')}</small>
            {broker.trace.map((entry, index) => (
              <details key={index}>
                <summary>
                  <code>{entry.level}</code> {entry.event}
                </summary>
                <pre>{JSON.stringify(entry.detail, null, 2)}</pre>
              </details>
            ))}
          </div>
        )}
      </div>
    </details>
  );
}
