// Read-only presentation identities; these do not register domain capabilities.
const glyphs = {
  pcb: (
    <>
      <rect x={3} y={3} width={14} height={14} rx={1.75} />
      <circle cx={6.5} cy={6.5} r={1.25} />
      <circle cx={13.5} cy={13.5} r={1.25} />
      <path d="M7.75 6.5H10v7h2.25M3 11h3.5v6M13.5 3v3.5H17" />
    </>
  ),
  chip: (
    <>
      <rect x={5} y={5} width={10} height={10} rx={1.5} />
      <rect x={8} y={8} width={4} height={4} rx={0.5} />
      <path d="M8 2.5V5m4-2.5V5M8 15v2.5m4-2.5v2.5M2.5 8H5m-2.5 4H5M15 8h2.5M15 12h2.5" />
    </>
  ),
  cad: (
    <>
      <path d="m10 2.75 6.5 3.75V14L10 17.75 3.5 14V6.5L10 2.75Z" />
      <path d="m3.5 6.5 6.5 3.75 6.5-3.75M10 10.25v7.5" />
    </>
  ),
  godot: (
    <>
      <path d="M6.3 5h7.4c1.55 0 2.6 1.06 2.96 2.6l1.14 5.66c.46 2.3-1.55 3.53-3.16 1.84L12.6 13H7.4l-2.04 2.1c-1.61 1.69-3.62.46-3.16-1.84L3.34 7.6C3.7 6.06 4.75 5 6.3 5Z" />
      <path d="M5.5 9h4M7.5 7v4" />
      <circle cx={13} cy={8} r={0.85} fill="currentColor" stroke="none" />
      <circle cx={15} cy={10} r={0.85} fill="currentColor" stroke="none" />
    </>
  ),
  cuda: (
    <>
      <rect x={2.75} y={4} width={14.5} height={11} rx={1.5} />
      <path d="M6.5 15v2M10 15v2m3.5-2v2" />
      <path d="M6 7v1M10 7v1M14 7v1M6 11v1M10 11v1M14 11v1" strokeWidth={2} />
    </>
  ),
  'industrial-software': (
    <>
      <path d="M5 5V3.5A1.5 1.5 0 0 1 6.5 2h10A1.5 1.5 0 0 1 18 3.5v10a1.5 1.5 0 0 1-1.5 1.5H15" />
      <rect x={2} y={5} width={13} height={13} rx={1.5} />
      <path d="M2 9h13M6 12.5l-1.5 1.5L6 15.5m5-3 1.5 1.5-1.5 1.5" />
    </>
  ),
  'physics-chemistry': (
    <>
      <path d="M7 2.5h6M8 2.5v5l-4.45 7.1A1.9 1.9 0 0 0 5.16 17.5h9.68a1.9 1.9 0 0 0 1.61-2.9L12 7.5v-5" />
      <circle cx={7.4} cy={14.2} r={1} />
      <circle cx={11.6} cy={12} r={1} />
      <path d="m8.29 13.74 2.42-1.28" />
    </>
  ),
  generic: (
    <>
      <rect x={3} y={3} width={5} height={5} rx={1} />
      <rect x={12} y={3} width={5} height={5} rx={1} />
      <rect x={3} y={12} width={5} height={5} rx={1} />
      <path d="M12 14.5h5m-2.5-2.5v5" />
    </>
  ),
};

type Props = {
  domain?: string | null;
  size?: number;
  className?: string;
};

/** Decorative icon: callers keep the visible domain label or name the containing control. */
export function DomainIcon({ domain, size = 16, className = '' }: Props) {
  const name =
    domain && Object.hasOwn(glyphs, domain) ? (domain as keyof typeof glyphs) : 'generic';
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`ia-domain-icon ${className}`.trim()}
      style={{ display: 'inline-block', flexShrink: 0, verticalAlign: 'middle' }}
      aria-hidden="true"
      focusable="false"
    >
      {glyphs[name]}
    </svg>
  );
}
