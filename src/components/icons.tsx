/**
 * The icon set.
 *
 * Drawn here rather than pulled from a library: this app needs six glyphs, and
 * they all share one construction — 24px box, 1.5 stroke, round caps, no fill —
 * so they sit together without a package to keep in step. Emoji were never an
 * option; they're a different typeface at a different weight in every browser.
 */

type IconProps = {
  className?: string;
  /** Decorative by default; pass a label when the icon is the only content. */
  label?: string;
};

function Svg({
  className = "size-4",
  label,
  children,
}: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden={label ? undefined : true}
      role={label ? "img" : undefined}
      aria-label={label}
    >
      {children}
    </svg>
  );
}

export function LinkIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7" />
      <path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" />
    </Svg>
  );
}

export function CameraIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3 8.5A1.5 1.5 0 0 1 4.5 7h2.2a1.5 1.5 0 0 0 1.25-.67l.6-.9A1.5 1.5 0 0 1 9.8 4.5h4.4a1.5 1.5 0 0 1 1.25.93l.6.9A1.5 1.5 0 0 0 17.3 7h2.2A1.5 1.5 0 0 1 21 8.5v9A1.5 1.5 0 0 1 19.5 19h-15A1.5 1.5 0 0 1 3 17.5z" />
      <circle cx="12" cy="13" r="3.5" />
    </Svg>
  );
}

export function CheckIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="m4.5 12.5 5 5 10-11" />
    </Svg>
  );
}

export function TrashIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 7h16M10 7V5.5A1.5 1.5 0 0 1 11.5 4h1A1.5 1.5 0 0 1 14 5.5V7" />
      <path d="M6 7l.8 11.2A1.8 1.8 0 0 0 8.6 20h6.8a1.8 1.8 0 0 0 1.8-1.8L18 7" />
    </Svg>
  );
}

export function SpinnerIcon({ className = "size-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={`${className} animate-spin`} aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth={1.5} opacity={0.25} />
      <path
        d="M21 12a9 9 0 0 0-9-9"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
      />
    </svg>
  );
}

export function PlusIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 5v14M5 12h14" />
    </Svg>
  );
}

export function RotateIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M20 12a8 8 0 1 1-2.4-5.7" />
      <path d="M20 4v4h-4" />
    </Svg>
  );
}

export function ClipboardIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M9 5H7.5A1.5 1.5 0 0 0 6 6.5v12A1.5 1.5 0 0 0 7.5 20h9a1.5 1.5 0 0 0 1.5-1.5v-12A1.5 1.5 0 0 0 16.5 5H15" />
      <rect x="9" y="3.5" width="6" height="3" rx="1" />
    </Svg>
  );
}

export function AlertIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 8.5v4.5" />
      <path d="M12 16.2v.3" />
      <circle cx="12" cy="12" r="8.5" />
    </Svg>
  );
}

export function XIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M6.5 6.5l11 11" />
      <path d="M17.5 6.5l-11 11" />
    </Svg>
  );
}

export function SunIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M18.4 5.6L17 7M7 17l-1.4 1.4" />
    </Svg>
  );
}

export function CloudRainIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M7 15.5a3.75 3.75 0 0 1 .3-7.5 5.25 5.25 0 0 1 10 1.2A3.4 3.4 0 0 1 17 15.5H7z" />
      <path d="M9 18.5l-.8 2M13 18.5l-.8 2M17 18.5l-.8 2" />
    </Svg>
  );
}

export function BellIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M6.5 9.5a5.5 5.5 0 0 1 11 0c0 4 1.3 5.4 1.8 5.9a.55.55 0 0 1-.38.94H5.08a.55.55 0 0 1-.38-.94c.5-.5 1.8-1.9 1.8-5.9z" />
      <path d="M10 19.2a2.2 2.2 0 0 0 4 0" />
    </Svg>
  );
}

export function InboxIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3.5 13.5h4l1.2 2.2h6.6l1.2-2.2h4" />
      <path d="M5.6 5h12.8l2.1 8.5v4a1.5 1.5 0 0 1-1.5 1.5h-14a1.5 1.5 0 0 1-1.5-1.5v-4z" />
    </Svg>
  );
}

export function SearchIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M15.8 15.8l4 4" />
    </Svg>
  );
}

export function TrendDownIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 7.5l6 6 3.5-3.5L20 16.5" />
      <path d="M20 11.5v5h-5" />
    </Svg>
  );
}

export function SparkIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 3.5l1.9 5.1 5.1 1.9-5.1 1.9L12 17.5l-1.9-5.1L5 10.5l5.1-1.9z" />
      <path d="M18.5 16.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z" />
    </Svg>
  );
}
