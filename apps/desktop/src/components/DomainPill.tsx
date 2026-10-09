import { DomainIcon } from '@industrial-agent-harness/viewer-builtin/domain-icon';
import { useDisplayText } from '@industrial-agent-harness/viewer-builtin/text';
import type { DomainOption } from '@industrial-agent-harness/viewer-builtin/api';

export function DomainPill({
  domain,
  domains,
  label,
}: {
  domain: string | null;
  domains: DomainOption[];
  label?: string;
}) {
  const { t } = useDisplayText();
  const selected = domains.find(item => item.id === domain);
  return (
    <span
      className="ia-domain-pill"
      role="status"
      aria-label={`${t(label || 'Domain')}: ${t(selected?.label || domain || 'None')}`}
    >
      <DomainIcon domain={domain} size={14} />
      <span>{t(selected?.label || domain || 'No domain')}</span>
    </span>
  );
}
