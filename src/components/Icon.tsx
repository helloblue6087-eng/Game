/**
 * Inline SVG icon set.
 *
 * Hand-rolled rather than pulled from an icon package so the bundle stays small
 * and the console has no runtime dependency on a CDN. All icons share a
 * consistent 24x24 grid and currentColor stroke.
 */

export type IconName =
  | "home"
  | "agent"
  | "terminal"
  | "pc"
  | "folder"
  | "activity"
  | "list"
  | "settings"
  | "shield"
  | "devices"
  | "play"
  | "stop"
  | "send"
  | "plus"
  | "trash"
  | "close"
  | "refresh"
  | "chevronRight"
  | "chevronDown"
  | "check"
  | "alert"
  | "lock"
  | "search"
  | "expand"
  | "power"
  | "bolt"
  | "bell"
  | "clock"
  | "offline"
  | "dot"
  | "cpu"
  | "memory"
  | "disk"
  | "network"
  | "temp"
  | "file"
  | "save"
  | "edit"
  | "copy"
  | "eye"
  | "eyeOff"
  | "retry"
  | "more"
  | "arrowLeft"
  | "shieldCheck";

const PATHS: Record<IconName, string> = {
  home: "M3 10.5 12 3l9 7.5M5.5 9.5V20h13V9.5M9.5 20v-6h5v6",
  agent: "M12 3v3m0 0a5 5 0 0 1 5 5v3a5 5 0 0 1-10 0v-3a5 5 0 0 1 5-5ZM5 12H3m18 0h-2M7 19l-1.5 2M17 19l1.5 2",
  terminal: "M4 5h16v14H4zM7.5 10l2.5 2-2.5 2M13 14h4",
  pc: "M3 5h18v11H3zM8 20h8M12 16v4",
  folder: "M3 6.5A1.5 1.5 0 0 1 4.5 5h4l2 2.5h8A1.5 1.5 0 0 1 20 9v9.5A1.5 1.5 0 0 1 18.5 20h-14A1.5 1.5 0 0 1 3 18.5Z",
  activity: "M3 12h4l2.5-7 4 14L16.5 12H21",
  list: "M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01",
  settings:
    "M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-2.9 1.2V21a2 2 0 1 1-4 0v-.09A1.7 1.7 0 0 0 6.7 19.4l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 3 13.7H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.6 6.7l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 10.3 3V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 2.9 1.2l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 21 10.3H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.51.7Z",
  shield: "M12 3l7.5 3v6c0 4.2-3 7.8-7.5 9-4.5-1.2-7.5-4.8-7.5-9V6Z",
  shieldCheck: "M12 3l7.5 3v6c0 4.2-3 7.8-7.5 9-4.5-1.2-7.5-4.8-7.5-9V6ZM9 12l2 2 4-4",
  devices: "M4 6h10v9H4zM16 9h4v9h-4zM7 18h4v2H7zM18 21h.01",
  play: "M8 5.5v13l11-6.5Z",
  stop: "M7 7h10v10H7z",
  send: "M4.5 12 20 4.5l-3 7.5 3 7.5Z",
  plus: "M12 5v14M5 12h14",
  trash: "M4.5 7h15M9.5 7V5h5v2M6.5 7l.8 12.5h9.4L17.5 7M10 11v5M14 11v5",
  close: "M6 6l12 12M18 6 6 18",
  refresh: "M20 11A8 8 0 0 0 6.3 6.3L4 8.5M4 5v3.5h3.5M4 13a8 8 0 0 0 13.7 4.7L20 15.5M20 19v-3.5h-3.5",
  chevronRight: "M9.5 5.5 16 12l-6.5 6.5",
  chevronDown: "M5.5 9.5 12 16l6.5-6.5",
  check: "M5 12.5 9.5 17 19 7",
  alert: "M12 4 2.5 20h19ZM12 10v4.5M12 17.5h.01",
  lock: "M6 11V8a6 6 0 0 1 12 0v3M5 11h14v9H5z",
  search: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14ZM16.5 16.5 21 21",
  expand: "M4 9V4h5M20 15v5h-5M20 9V4h-5M4 15v5h5",
  power: "M12 3v9M6.5 6.5a8 8 0 1 0 11 0",
  bolt: "M13 2 4.5 13.5H11L10 22l8.5-11.5H12Z",
  bell: "M6 9a6 6 0 1 1 12 0v5l1.5 3H4.5L6 14ZM10 20a2 2 0 0 0 4 0",
  clock: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 7.5V12l3 2",
  offline: "M3 3l18 18M8.5 16.5a5 5 0 0 1 7 0M5 13a10 10 0 0 1 4-2.5M19 13a10 10 0 0 0-3-2.2M12 20h.01",
  dot: "M12 12h.01",
  cpu: "M8 8h8v8H8zM4 9h2M4 12h2M4 15h2M18 9h2M18 12h2M18 15h2M9 4v2M12 4v2M15 4v2M9 18v2M12 18v2M15 18v2",
  memory: "M3 8h18v8H3zM7 8v8M12 8v8M17 8v8",
  disk: "M12 4c4.4 0 8 1.3 8 3s-3.6 3-8 3-8-1.3-8-3 3.6-3 8-3ZM4 7v10c0 1.7 3.6 3 8 3s8-1.3 8-3V7",
  network: "M12 20h.01M8.5 16.5a5 5 0 0 1 7 0M5 13a10 10 0 0 1 14 0M2 9.5a14 14 0 0 1 20 0",
  temp: "M12 14V5a2 2 0 1 1 4 0v9a4 4 0 1 1-4 0ZM12 5H9m3 4H9m3 4H9",
  file: "M6 3h7l5 5v13H6zM13 3v5h5",
  save: "M5 4h11l3 3v13H5zM8 4v6h8V4M8 20v-6h8v6",
  edit: "M4 20h4L20 8l-4-4L4 16ZM14 6l4 4",
  copy: "M9 9h10v12H9zM5 15V3h10",
  eye: "M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12ZM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z",
  eyeOff: "M4 4l16 16M9.9 5.9A9 9 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a17 17 0 0 1-3.4 4.2M6.4 7.9A16 16 0 0 0 2.5 12S6 18.5 12 18.5c1 0 1.9-.2 2.7-.5",
  retry: "M20 12a8 8 0 1 1-2.3-5.7M20 4v4.5h-4.5",
  more: "M6 12h.01M12 12h.01M18 12h.01",
  arrowLeft: "M20 12H4M10 6l-6 6 6 6",
};

interface IconProps {
  name: IconName;
  className?: string;
  size?: number;
  strokeWidth?: number;
}

export function Icon({ name, className = "h-5 w-5", size, strokeWidth = 1.7 }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
