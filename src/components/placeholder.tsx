/**
 * Stand-in for a route that a later phase fills in.
 *
 * Better than a 404 from a nav link: the shell is navigable from day one and
 * each screen states what it will become and when.
 */
export function Placeholder({
  title,
  phase,
  description,
}: {
  title: string;
  phase: string;
  description: string;
}) {
  return (
    <div>
      <header className="mb-8">
        <h1 className="display text-2xl font-medium">{title}</h1>
      </header>
      <div className="rounded-card border border-dashed border-line-strong bg-surface-sunk px-6 py-16 text-center">
        <p className="label">{phase}</p>
        <p className="mx-auto mt-3 max-w-md text-sm text-ink-muted">
          {description}
        </p>
      </div>
    </div>
  );
}
