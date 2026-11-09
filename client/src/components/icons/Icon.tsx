import type { ReactNode, SVGProps } from 'react';

export type IconName =
  | 'plus'
  | 'search'
  | 'history'
  | 'memory'
  | 'tools'
  | 'settings'
  | 'panelLeft'
  | 'panelRight'
  | 'close'
  | 'chevronRight'
  | 'chevronLeft'
  | 'chevronDown'
  | 'send'
  | 'stop'
  | 'mic'
  | 'paperclip'
  | 'copy'
  | 'check'
  | 'activity'
  | 'trash'
  | 'edit'
  | 'refresh'
  | 'info'
  | 'warning'
  | 'sun'
  | 'moon'
  | 'monitor'
  | 'user'
  | 'code'
  | 'shield'
  | 'folder'
  | 'external'
  | 'node'
  | 'chat'
  | 'volume'
  | 'keyboard'
  | 'arrowUpRight'
  | 'bell'
  | 'cpu'
  | 'ram'
  | 'storage'
  | 'network'
  | 'volumeOff'
  | 'menu'
  | 'core'
  | 'waveform'
  | 'dots'
  | 'globe'
  | 'terminal';

const paths: Record<IconName, ReactNode> = {
  plus: <path d="M8 3.2v9.6M3.2 8h9.6" />,
  search: (
    <>
      <circle cx="7" cy="7" r="4.1" />
      <path d="M10.2 10.2 13.3 13.3" />
    </>
  ),
  history: (
    <>
      <circle cx="8" cy="8" r="5.4" />
      <path d="M8 4.9V8l2.1 1.4" />
    </>
  ),
  memory: (
    <>
      <rect x="2.8" y="3.2" width="10.4" height="3.4" rx="1" />
      <rect x="2.8" y="9.4" width="10.4" height="3.4" rx="1" />
    </>
  ),
  tools: (
    <>
      <rect x="2.6" y="2.6" width="4.4" height="4.4" rx="1" />
      <rect x="9" y="2.6" width="4.4" height="4.4" rx="1" />
      <rect x="2.6" y="9" width="4.4" height="4.4" rx="1" />
      <circle cx="11.2" cy="11.2" r="1.5" />
    </>
  ),
  settings: (
    <>
      <path d="M2.8 5.2h10.4M2.8 10.8h10.4" />
      <circle cx="6.1" cy="5.2" r="1.6" />
      <circle cx="9.9" cy="10.8" r="1.6" />
    </>
  ),
  panelLeft: (
    <>
      <rect x="2" y="3" width="12" height="10" rx="2" />
      <path d="M6.4 3v10" />
    </>
  ),
  panelRight: (
    <>
      <rect x="2" y="3" width="12" height="10" rx="2" />
      <path d="M9.6 3v10" />
    </>
  ),
  close: <path d="M4.2 4.2l7.6 7.6M11.8 4.2l-7.6 7.6" />,
  chevronRight: <path d="M6.2 3.8 10.4 8l-4.2 4.2" />,
  chevronLeft: <path d="M9.8 3.8 5.6 8l4.2 4.2" />,
  chevronDown: <path d="M3.8 6.2 8 10.4l4.2-4.2" />,
  send: <path d="M8 13.2V3.2M3.8 7.4 8 3.2l4.2 4.2" />,
  stop: <rect x="5" y="5" width="6" height="6" rx="1" fill="currentColor" stroke="none" />,
  mic: (
    <>
      <rect x="6" y="2.4" width="4" height="7.2" rx="2" />
      <path d="M3.6 8.2a4.4 4.4 0 0 0 8.8 0M8 12.6v1.6" />
    </>
  ),
  paperclip: <path d="M6.1 9.9 10.4 5.6a2.2 2.2 0 0 1 3.1 3.1L8 14.2a3.5 3.5 0 0 1-5-5L9 3.3" />,
  copy: (
    <>
      <rect x="5.6" y="5.6" width="7.8" height="7.8" rx="1.6" />
      <path d="M10.4 5.6V4.1a1.6 1.6 0 0 0-1.6-1.6H4.1a1.6 1.6 0 0 0-1.6 1.6v4.7a1.6 1.6 0 0 0 1.6 1.6h1.5" />
    </>
  ),
  check: <path d="M3.2 8.6 6.4 11.6 12.8 4.6" />,
  activity: <path d="M2 8.2h2.4l1.6-4.6 2.6 9 1.8-4.4H14" />,
  trash: (
    <>
      <path d="M2.8 4.4h10.4M6.2 4.4V3.2a1 1 0 0 1 1-1h1.6a1 1 0 0 1 1 1v1.2" />
      <path d="M4.4 4.4l.7 9a1.2 1.2 0 0 0 1.2 1.1h3.4a1.2 1.2 0 0 0 1.2-1.1l.7-9M6.6 7v4.6M9.4 7v4.6" />
    </>
  ),
  edit: (
    <>
      <path d="M11.2 2.9 13.1 4.8 6 11.9l-2.6.7.7-2.6z" />
      <path d="M10 4.1l1.9 1.9" />
    </>
  ),
  refresh: <path d="M13 8a5 5 0 1 1-1.6-3.7M13.2 2.6v3.1h-3.1" />,
  info: (
    <>
      <circle cx="8" cy="8" r="5.6" />
      <path d="M8 7.3v3.6M8 5.2v.1" />
    </>
  ),
  warning: (
    <>
      <path d="M8 2.4 13.9 13H2.1z" />
      <path d="M8 6.2v3.4M8 11.4v.1" />
    </>
  ),
  sun: (
    <>
      <circle cx="8" cy="8" r="2.6" />
      <path d="M8 1.8v1.6M8 12.6v1.6M1.8 8h1.6M12.6 8h1.6M3.6 3.6l1.1 1.1M11.3 11.3l1.1 1.1M12.4 3.6l-1.1 1.1M4.7 11.3l-1.1 1.1" />
    </>
  ),
  moon: <path d="M12.8 9.4A5.2 5.2 0 0 1 6.6 3.2 5.4 5.4 0 1 0 12.8 9.4z" />,
  monitor: (
    <>
      <rect x="2" y="3" width="12" height="8" rx="1.4" />
      <path d="M6 13.6h4M8 11v2.6" />
    </>
  ),
  user: (
    <>
      <circle cx="8" cy="5.6" r="2.4" />
      <path d="M3.4 13.4a4.6 4.6 0 0 1 9.2 0" />
    </>
  ),
  code: <path d="M5.6 5.2 2.8 8l2.8 2.8M10.4 5.2 13.2 8l-2.8 2.8" />,
  shield: <path d="M8 2.2 13 4v3.6c0 3-2.1 5.3-5 6.2-2.9-.9-5-3.2-5-6.2V4z" />,
  folder: (
    <path d="M2.4 4.6a1.2 1.2 0 0 1 1.2-1.2h2.5l1.4 1.6h4.9a1.2 1.2 0 0 1 1.2 1.2v6.6a1.2 1.2 0 0 1-1.2 1.2H3.6a1.2 1.2 0 0 1-1.2-1.2z" />
  ),
  external: (
    <>
      <path d="M6.6 3.2H3.6A1.6 1.6 0 0 0 2 4.8v7.6A1.6 1.6 0 0 0 3.6 14h7.6a1.6 1.6 0 0 0 1.6-1.6v-2.8" />
      <path d="M9.6 2.4h4v4M13.2 2.8 7.6 8.4" />
    </>
  ),
  node: (
    <>
      <path d="M8 1.9 13.4 5v6L8 14.1 2.6 11V5z" />
      <circle cx="8" cy="8" r="1.5" />
    </>
  ),
  chat: (
    <>
      <path d="M2.6 4.6a1.8 1.8 0 0 1 1.8-1.8h7.2a1.8 1.8 0 0 1 1.8 1.8v4.6a1.8 1.8 0 0 1-1.8 1.8H7.4l-3.6 2.5v-2.5h-.4a.8.8 0 0 1-.8-.8z" />
    </>
  ),
  volume: (
    <>
      <path d="M3 6.3h2.2L8.4 3.4v9.2L5.2 9.7H3z" />
      <path d="M10.6 6.1a2.7 2.7 0 0 1 0 3.8M12.2 4.5a5 5 0 0 1 0 7" />
    </>
  ),
  keyboard: (
    <>
      <rect x="1.8" y="4.4" width="12.4" height="7.2" rx="1.4" />
      <path d="M4.4 6.8h.1M6.8 6.8h.1M9.2 6.8h.1M11.6 6.8h.1M5.2 9.4h5.6" />
    </>
  ),
  arrowUpRight: <path d="M5 11 11 5M6.2 5H11v4.8" />,
  bell: (
    <>
      <path d="M4.2 11.2h7.6l-1-1.5V6.6a2.8 2.8 0 0 0-5.6 0v3.1z" />
      <path d="M6.7 12.7a1.4 1.4 0 0 0 2.6 0" />
    </>
  ),
  cpu: (
    <>
      <rect x="4.6" y="4.6" width="6.8" height="6.8" rx="1.2" />
      <rect x="6.7" y="6.7" width="2.6" height="2.6" rx="0.6" />
      <path d="M6.2 2.4v2.2M9.8 2.4v2.2M6.2 11.4v2.2M9.8 11.4v2.2M2.4 6.2h2.2M2.4 9.8h2.2M11.4 6.2h2.2M11.4 9.8h2.2" />
    </>
  ),
  ram: (
    <>
      <rect x="1.8" y="4.4" width="12.4" height="7.2" rx="1.2" />
      <path d="M4.5 6.8v2.4M6.8 6.8v2.4M9.2 6.8v2.4M11.5 6.8v2.4" />
    </>
  ),
  storage: (
    <>
      <ellipse cx="8" cy="4.2" rx="5.2" ry="2" />
      <path d="M2.8 4.2v3.6c0 1.1 2.3 2 5.2 2s5.2-.9 5.2-2V4.2" />
      <path d="M2.8 7.8v3.6c0 1.1 2.3 2 5.2 2s5.2-.9 5.2-2V7.8" />
    </>
  ),
  network: (
    <>
      <circle cx="8" cy="3.4" r="1.6" />
      <circle cx="3.4" cy="12" r="1.6" />
      <circle cx="12.6" cy="12" r="1.6" />
      <path d="M8 5v2.8M6.8 9.4 4.4 10.8M9.2 9.4l2.4 1.4" />
    </>
  ),
  volumeOff: (
    <>
      <path d="M3 6.3h2.2L8.4 3.4v9.2L5.2 9.7H3z" />
      <path d="M10.8 6.2 13.4 8.8M13.4 6.2 10.8 8.8" />
    </>
  ),
  menu: <path d="M2.8 4.8h10.4M2.8 8h10.4M2.8 11.2h7.4" />,
  core: (
    <>
      <circle cx="8" cy="8" r="5.4" />
      <circle cx="8" cy="8" r="2.4" />
      <path d="M8 1.4v1.4M8 13.2v1.4M1.4 8h1.4M13.2 8h1.4" />
    </>
  ),
  waveform: <path d="M2.2 8h1.1M4.8 5.6v4.8M7.4 3.4v9.2M10 6.2v3.6M12.6 4.8v6.4M14 8h-.2" />,
  dots: (
    <>
      <circle cx="3.4" cy="8" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="8" cy="8" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="12.6" cy="8" r="0.9" fill="currentColor" stroke="none" />
    </>
  ),
  globe: (
    <>
      <circle cx="8" cy="8" r="5.6" />
      <path d="M2.4 8h11.2M8 2.4c2.2 1.8 2.2 9.4 0 11.2M8 2.4c-2.2 1.8-2.2 9.4 0 11.2" />
    </>
  ),
  terminal: (
    <>
      <rect x="1.8" y="2.8" width="12.4" height="10.4" rx="1.4" />
      <path d="m4.5 6.2 1.8 1.8-1.8 1.8M8.4 9.8h3" />
    </>
  ),
};

interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'name'> {
  name: IconName;
  size?: number;
  strokeWidth?: number;
}

export function Icon({
  name,
  size = 16,
  strokeWidth = 1.35,
  className,
  ...rest
}: IconProps): React.JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
      {...rest}
    >
      {paths[name]}
    </svg>
  );
}

export function CaeraMark({
  size = 20,
  className,
}: {
  size?: number;
  className?: string;
}): React.JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      <circle cx="12" cy="12" r="9.1" stroke="currentColor" strokeWidth="0.65" opacity="0.28" />
      <path
        d="M12 2.9a9.1 9.1 0 0 1 6.44 2.66"
        stroke="currentColor"
        strokeWidth="1.35"
        strokeLinecap="round"
      />
      <path
        d="M21.1 12a9.1 9.1 0 0 1-2.66 6.44"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinecap="round"
        opacity="0.72"
      />
      <path
        d="M12 21.1a9.1 9.1 0 0 1-6.44-2.66"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinecap="round"
        opacity="0.48"
      />
      <path d="M2.9 12a9.1 9.1 0 0 1 2.66-6.44" stroke="currentColor" strokeWidth="0.8" strokeLinecap="round" opacity="0.42" />
      <path
        d="M12 6.2 17.8 12 12 17.8 6.2 12Z"
        stroke="currentColor"
        strokeWidth="0.85"
        opacity="0.9"
      />
      <path d="M12 8.2v7.6" stroke="currentColor" strokeWidth="0.95" opacity="0.62" />
      <circle cx="12" cy="12" r="1.25" fill="currentColor" opacity="0.95" />
    </svg>
  );
}
