import React from 'react'

export type IconName =
  | 'plus'
  | 'play'
  | 'stop'
  | 'pause'
  | 'pencil'
  | 'trash'
  | 'copy'
  | 'close'
  | 'search'
  | 'check'
  | 'x'
  | 'clock'
  | 'calendar'
  | 'terminal'
  | 'kebab'
  | 'folder'
  | 'bell'
  | 'bolt'
  | 'gear'
  | 'warn'
  | 'skip'
  | 'moon'

const PATHS: Record<IconName, React.ReactNode> = {
  plus: <path d="M12 5v14M5 12h14" />,
  play: <path d="M8 5.5v13l11-6.5-11-6.5z" fill="currentColor" stroke="none" />,
  stop: <rect x="7" y="7" width="10" height="10" rx="1.5" fill="currentColor" stroke="none" />,
  pause: (
    <g fill="currentColor" stroke="none">
      <rect x="7" y="5.5" width="3.4" height="13" rx="1.2" />
      <rect x="13.6" y="5.5" width="3.4" height="13" rx="1.2" />
    </g>
  ),
  pencil: <path d="M4 20l4.5-.9L19 8.6a2 2 0 0 0 0-2.8l-.8-.8a2 2 0 0 0-2.8 0L4.9 15.5 4 20z" />,
  trash: (
    <>
      <path d="M4 7h16M9.5 7V5a1.5 1.5 0 0 1 1.5-1.5h2A1.5 1.5 0 0 1 14.5 5v2M6.5 7l.8 12a1.5 1.5 0 0 0 1.5 1.4h6.4a1.5 1.5 0 0 0 1.5-1.4l.8-12" />
      <path d="M10 11v6M14 11v6" />
    </>
  ),
  copy: (
    <>
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15H4.8A1.8 1.8 0 0 1 3 13.2V4.8A1.8 1.8 0 0 1 4.8 3h8.4A1.8 1.8 0 0 1 15 4.8V5" />
    </>
  ),
  close: <path d="M6 6l12 12M18 6L6 18" />,
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M16 16l4.5 4.5" />
    </>
  ),
  check: <path d="M4.5 12.5l5 5L19.5 7" />,
  x: <path d="M6 6l12 12M18 6L6 18" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  calendar: (
    <>
      <rect x="3.5" y="5" width="17" height="15.5" rx="2.5" />
      <path d="M3.5 9.5h17M8 3v3.5M16 3v3.5" />
    </>
  ),
  terminal: (
    <>
      <rect x="3" y="4.5" width="18" height="15" rx="2.5" />
      <path d="M7 9.5l3.2 2.8L7 15M12.5 15.5H17" />
    </>
  ),
  kebab: (
    <g fill="currentColor" stroke="none">
      <circle cx="12" cy="5.5" r="1.6" />
      <circle cx="12" cy="12" r="1.6" />
      <circle cx="12" cy="18.5" r="1.6" />
    </g>
  ),
  folder: <path d="M3.5 7A2.5 2.5 0 0 1 6 4.5h3.2c.7 0 1.4.3 1.9.9l.9 1.1h6A2.5 2.5 0 0 1 20.5 9v8A2.5 2.5 0 0 1 18 19.5H6A2.5 2.5 0 0 1 3.5 17V7z" />,
  bell: <path d="M6 16.5v-6a6 6 0 0 1 12 0v6l1.5 2h-15l1.5-2zM10 20.5a2 2 0 0 0 4 0" />,
  bolt: <path d="M13 3L5.5 13.5H11L10 21l7.5-10.5H12L13 3z" fill="currentColor" stroke="none" />,
  gear: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19 12a7 7 0 0 0-.14-1.4l2-1.55-2-3.46-2.36.95a7 7 0 0 0-2.42-1.4L13.7 2.6h-3.4l-.38 2.54a7 7 0 0 0-2.42 1.4l-2.36-.95-2 3.46 2 1.55A7 7 0 0 0 5 12c0 .48.05.94.14 1.4l-2 1.55 2 3.46 2.36-.95a7 7 0 0 0 2.42 1.4l.38 2.54h3.4l.38-2.54a7 7 0 0 0 2.42-1.4l2.36.95 2-3.46-2-1.55c.09-.46.14-.92.14-1.4z" />
    </>
  ),
  warn: (
    <>
      <path d="M12 3.5L2.5 20h19L12 3.5z" />
      <path d="M12 10v4.5" strokeLinecap="round" />
      <circle cx="12" cy="17.2" r="0.4" fill="currentColor" />
    </>
  ),
  skip: <path d="M5 5.5v13l9-6.5-9-6.5zM17 5.5v13" />,
  moon: <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z" />,
}

export function Icon({ name, size = 16, className }: { name: IconName; size?: number; className?: string }): React.ReactElement {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {PATHS[name]}
    </svg>
  )
}
