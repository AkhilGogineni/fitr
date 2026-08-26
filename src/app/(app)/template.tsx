/**
 * Re-mounts on every route change, so navigation gets one quiet breath of
 * continuity — the page settling onto the bench rather than snapping in.
 * Pure CSS; nothing here waits on JavaScript, and reduced-motion turns it off.
 */
export default function AppTemplate({ children }: { children: React.ReactNode }) {
  return <div className="animate-page">{children}</div>;
}
