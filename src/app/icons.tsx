// Small inline icons for the retro skin. Decorative only: every use sits next
// to a text label, so they are hidden from assistive tech.

const PATHS = {
  home: (
    <>
      <path d="M1.5 8.2 8 2l6.5 6.2" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M3.5 7.5V14h3.4v-4h2.2v4h3.4V7.5" fill="currentColor" />
    </>
  ),
  play: <path d="M4 2.2v11.6L13.6 8z" fill="currentColor" />,
  refresh: (
    <>
      <path d="M13 8a5 5 0 1 1-1.6-3.7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M13.8 1.6v4.3H9.5z" fill="currentColor" />
    </>
  ),
  list: (
    <>
      <rect x="2" y="3" width="2.2" height="2.2" fill="currentColor" />
      <rect x="2" y="7" width="2.2" height="2.2" fill="currentColor" />
      <rect x="2" y="11" width="2.2" height="2.2" fill="currentColor" />
      <rect x="6" y="3.3" width="8" height="1.6" fill="currentColor" />
      <rect x="6" y="7.3" width="8" height="1.6" fill="currentColor" />
      <rect x="6" y="11.3" width="8" height="1.6" fill="currentColor" />
    </>
  ),
  copy: (
    <>
      <rect x="5" y="5" width="8.5" height="9" rx="1" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M3.5 10.5h-1v-9h8v1" fill="none" stroke="currentColor" strokeWidth="1.6" />
    </>
  ),
  download: (
    <>
      <path d="M8 1.5v8M4.5 6.5 8 10l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
      <path d="M2 11.5v2.5h12v-2.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
    </>
  ),
  folder: (
    <>
      <path d="M1 3.5h5l1.5 1.5H15v8.5H1z" fill="#d9a514" />
      <path d="M1 6.5h14v7H1z" fill="#ffd34d" />
      <path d="M1 6.5h14" stroke="#fff3b8" strokeWidth="0.8" />
    </>
  ),
  doc: (
    <>
      <path d="M3 1h7l3 3v11H3z" fill="#f4f6fa" stroke="#5d6370" strokeWidth="0.8" />
      <path d="M10 1v3h3" fill="#c9ced8" stroke="#5d6370" strokeWidth="0.8" />
      <path d="M5 7h6M5 9.5h6M5 12h4" stroke="#5d6370" strokeWidth="0.9" />
    </>
  ),
  tax: (
    <>
      <rect x="2" y="1" width="12" height="14" rx="1.5" fill="#3a3f4b" />
      <rect x="3.5" y="2.5" width="9" height="3.5" fill="#7dfc5c" />
      <g fill="#dfe3ea">
        <rect x="3.5" y="7.5" width="2.4" height="2" />
        <rect x="6.8" y="7.5" width="2.4" height="2" />
        <rect x="10.1" y="7.5" width="2.4" height="2" />
        <rect x="3.5" y="11" width="2.4" height="2" />
        <rect x="6.8" y="11" width="2.4" height="2" />
      </g>
      <rect x="10.1" y="11" width="2.4" height="2" fill="#ff7a1a" />
    </>
  ),
  warn: (
    <>
      <path d="M8 1.5 15 14H1z" fill="currentColor" />
      <path d="M8 6v4M8 11.4v1.2" stroke="#14161c" strokeWidth="1.8" />
    </>
  ),
  check: <path d="M2.5 8.5 6.2 12 13.5 4" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />,
  dot: <circle cx="8" cy="8" r="4" fill="currentColor" />,
  briefcase: (
    <>
      <path d="M5.5 4V2.5h5V4" fill="none" stroke="#6b3f12" strokeWidth="1.4" />
      <rect x="1" y="4" width="14" height="10" rx="1.5" fill="#a8652a" />
      <rect x="1" y="7.5" width="14" height="1.4" fill="#6b3f12" />
      <rect x="7" y="7" width="2" height="2.4" fill="#f1c26b" />
    </>
  ),
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, className }: { name: IconName; className?: string }) {
  return (
    <svg className={className ? `icon ${className}` : "icon"} viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      {PATHS[name]}
    </svg>
  );
}
