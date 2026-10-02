// Small stroke icons (24px grid, 1.75 stroke) so every control shares one visual language.

type P = { size?: number; className?: string };

const Svg = ({ size = 18, className, children }: P & { children: React.ReactNode }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
    {children}
  </svg>
);

export const IconMap = (p: P) => (
  <Svg {...p}>
    <path d="M9 4 3.5 6v14L9 18l6 2 5.5-2V4L15 6 9 4Z" />
    <path d="M9 4v14M15 6v14" />
  </Svg>
);

export const IconTarget = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="7.5" />
    <circle cx="12" cy="12" r="2.5" />
    <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
  </Svg>
);

export const IconStreet = (p: P) => (
  <Svg {...p}>
    <path d="M7 21 10 3M17 21 14 3" />
    <path d="M12 6v2M12 11.5v2M12 17v2.5" />
  </Svg>
);

export const IconSound = ({ on, ...p }: P & { on: boolean }) => (
  <Svg {...p}>
    <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" />
    {on ? <path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" /> : <path d="m16 10 4.5 4.5M20.5 10 16 14.5" />}
  </Svg>
);

export const IconInfo = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5.5M12 7.6v.01" />
  </Svg>
);

export const IconPlay = (p: P) => (
  <svg width={p.size ?? 14} height={p.size ?? 14} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={p.className}>
    <path d="M7 4.8v14.4a1 1 0 0 0 1.5.86l12-7.2a1 1 0 0 0 0-1.72l-12-7.2A1 1 0 0 0 7 4.8Z" />
  </svg>
);

export const IconPause = (p: P) => (
  <svg width={p.size ?? 14} height={p.size ?? 14} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={p.className}>
    <rect x="6" y="4.5" width="4.2" height="15" rx="1.2" />
    <rect x="13.8" y="4.5" width="4.2" height="15" rx="1.2" />
  </svg>
);

export const IconChevron = ({ up, ...p }: P & { up?: boolean }) => (
  <Svg {...p}>
    <path d={up ? 'm6 15 6-6 6 6' : 'm6 9 6 6 6-6'} />
  </Svg>
);

export const IconClose = (p: P) => (
  <Svg {...p}>
    <path d="M6 6l12 12M18 6 6 18" />
  </Svg>
);

export const IconArrow = ({ down, ...p }: P & { down?: boolean }) => (
  <Svg {...p}>
    <path d={down ? 'M12 5v14m-5-5 5 5 5-5' : 'M12 19V5m-5 5 5-5 5 5'} />
  </Svg>
);

export const IconBolt = (p: P) => (
  <Svg {...p}>
    <path d="M13 3 5 13.5h6L10 21l8-10.5h-6L13 3Z" />
  </Svg>
);

export const Logo = ({ size = 28 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
    <rect width="32" height="32" rx="9" fill="#f4f4f5" />
    <path d="M7 23c3.5-9 14.5-9 18 0" stroke="#0c0c0e" strokeWidth="3.2" fill="none" strokeLinecap="round" />
    <circle cx="11.2" cy="16.8" r="1.9" fill="#ff9d4d" />
    <circle cx="20.8" cy="16.8" r="1.9" fill="#0c0c0e" />
  </svg>
);

export const IconMusic = (p: P) => (
  <Svg {...p}>
    <path d="M9 18V6l10-2v12" />
    <circle cx="6.5" cy="18" r="2.5" />
    <circle cx="16.5" cy="16" r="2.5" />
  </Svg>
);

/** Little rounded traffic signal used on the title logo. */
export const SignalMark = ({ size = 44 }: { size?: number }) => (
  <svg width={size} height={size * 1.7} viewBox="0 0 40 68" aria-hidden="true">
    <rect x="5" y="4" width="30" height="60" rx="15" fill="#2a2340" />
    <rect x="9" y="8" width="22" height="52" rx="11" fill="#3b3256" />
    <circle cx="20" cy="19" r="6.5" fill="#ff5a4e" />
    <circle cx="20" cy="34" r="6.5" fill="#ffc94a" />
    <circle cx="20" cy="49" r="6.5" fill="#3ddc84" />
  </svg>
);

export const IconChevronSide = ({ right, ...p }: P & { right?: boolean }) => (
  <Svg {...p}>
    <path d={right ? 'm9 6 6 6-6 6' : 'm15 6-6 6 6 6'} />
  </Svg>
);
