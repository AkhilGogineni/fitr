import Link from "next/link";

import { TrendDownIcon } from "@/components/icons";
import { MATCH_COLUMNS, type ProductMatchRow } from "@/lib/captures";
import { formatPrice } from "@/lib/garments";
import { btnTag } from "@/lib/ui";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Watch" };

/**
 * Everything being watched, and what its price has done.
 *
 * This is the primary surface for the price watch, not a fallback for it.
 * Notifications are opt-in and iOS only delivers them to an installed PWA, so a
 * design where the drop only exists as a notification is a design that fails
 * silently for most of its life. Every drop lands here regardless.
 *
 * The sparkline is drawn from the observations themselves rather than a stored
 * summary. `price_observations` is append-only, so the shape of the line is the
 * whole history and there's nothing to keep in sync.
 */
export default async function WatchPage() {
  const supabase = await createClient();

  const { data: matchRows, error } = await supabase
    .from("product_matches")
    .select(MATCH_COLUMNS)
    .eq("watching", true)
    .order("last_checked_at", { ascending: false, nullsFirst: false });

  if (error) {
    return (
      <div className="rounded-card border border-line bg-surface p-6">
        <h1 className="display text-lg font-medium">Watch</h1>
        <p className="mt-2 text-sm text-danger">Could not load: {error.message}</p>
      </div>
    );
  }

  const matches = (matchRows ?? []) as ProductMatchRow[];

  // One query for every observation across every watched match, then grouped in
  // memory. A watch list is tens of rows, not thousands, and a query per card
  // would be the only slow thing on this page.
  const { data: observationRows } = matches.length
    ? await supabase
        .from("price_observations")
        .select("product_match_id, price_cents, observed_at")
        .in(
          "product_match_id",
          matches.map((match) => match.id),
        )
        .order("observed_at", { ascending: true })
    : { data: [] };

  const history = new Map<string, { price: number; at: string }[]>();
  for (const row of (observationRows ?? []) as {
    product_match_id: string;
    price_cents: number | null;
    observed_at: string;
  }[]) {
    if (row.price_cents === null) continue;
    history.set(row.product_match_id, [
      ...(history.get(row.product_match_id) ?? []),
      { price: row.price_cents, at: row.observed_at },
    ]);
  }

  return (
    <div className="mx-auto max-w-3xl">
      <header className="mb-6">
        <h1 className="display text-4xl">Watch</h1>
        <p className="label nums mt-2">
          {matches.length === 0
            ? "Nothing being watched."
            : `${matches.length} ${matches.length === 1 ? "piece" : "pieces"}, checked daily`}
        </p>
      </header>

      {matches.length === 0 ? (
        <div className="rounded-card border border-dashed border-line-strong bg-surface-sunk px-6 py-14 text-center">
          <p className="mx-auto max-w-md text-sm leading-relaxed text-ink-muted">
            Find pieces for something on your list, then tap &ldquo;watch the
            price&rdquo; on any of them. A daily job reads the listed price and
            tells you when it falls.
          </p>
          <Link href="/inbox" className={`${btnTag} mt-4 inline-block text-sm`}>
            Go to the inbox
          </Link>
        </div>
      ) : (
        <ul className="space-y-3">
          {matches.map((match, index) => {
            const points = history.get(match.id) ?? [];
            const first = points[0]?.price ?? match.price_cents;
            const current = match.price_cents;
            const change =
              first !== null && current !== null && first > 0
                ? Math.round(((current - first) / first) * 100)
                : null;
            const lowest =
              points.length > 0 ? Math.min(...points.map((point) => point.price)) : null;
            const dropped = change !== null && change < 0;

            return (
              <li
                key={match.id}
                className={`animate-rise flex gap-4 rounded-card border bg-surface p-4 shadow-card transition-shadow duration-200 hover:shadow-lift ${
                  dropped ? "border-copper/50" : "border-line"
                }`}
                style={{ animationDelay: `${Math.min(index * 60, 360)}ms` }}
              >
                <div className="size-20 shrink-0 overflow-hidden rounded bg-surface-sunk">
                  {match.image_url ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={match.image_url}
                      alt={match.title ?? "Product"}
                      loading="lazy"
                      className="size-full object-cover"
                    />
                  ) : null}
                </div>

                <div className="min-w-0 flex-1">
                  <a
                    href={match.url}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="line-clamp-2 text-sm underline-offset-4 hover:underline"
                  >
                    {match.title ?? match.url}
                  </a>
                  <p className="label mt-0.5 truncate">
                    {match.brand ?? match.retailer}
                  </p>

                  <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <span className="text-base nums">{formatPrice(match.price_cents, match.currency) ?? "No price"}</span>
                    {dropped ? (
                      <span className="flex items-center gap-1 font-mono text-xs text-copper">
                        <TrendDownIcon className="size-3.5" />
                        {Math.abs(change)}% since first seen
                      </span>
                    ) : change !== null && change > 0 ? (
                      <span className="font-mono text-xs text-ink-faint nums">
                        up {change}% since first seen
                      </span>
                    ) : null}
                    {lowest !== null && lowest < (match.price_cents ?? Infinity) ? (
                      <span className="font-mono text-xs text-ink-faint nums">
                        low {formatPrice(lowest, match.currency)}
                      </span>
                    ) : null}
                  </div>

                  {points.length > 1 ? (
                    <Sparkline points={points.map((p) => p.price)} falling={dropped} />
                  ) : null}

                  <p className="mt-1.5 font-mono text-xs text-ink-faint nums">
                    {match.last_checked_at
                      ? `Checked ${new Date(match.last_checked_at).toLocaleDateString()}`
                      : "Not checked yet"}
                    {points.length > 0 ? ` · ${points.length} readings` : ""}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <p className="mt-8 font-mono text-xs leading-relaxed text-ink-faint">
        Prices are read from the structured data retailers publish for search
        engines. A page that publishes none can&apos;t be watched, and is marked as
        such rather than scraped.
      </p>
    </div>
  );
}

/**
 * The price history, drawn as an inline SVG that records itself.
 *
 * No chart library for a 100×20 line. It's normalised to its own min and max,
 * so the shape shows the movement rather than the absolute number — the number
 * is printed right above it. The line draws in left to right once on arrival,
 * like a needle writing the reading; reduced-motion flattens it to instant.
 */
function Sparkline({ points, falling }: { points: number[]; falling: boolean }) {
  const width = 100;
  const height = 20;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;

  const path = points
    .map((price, index) => {
      const x = (index / (points.length - 1)) * width;
      // Inverted: a lower price should sit lower on the chart, and SVG's y grows
      // downward, so this reads the way a price chart is expected to.
      const y = height - ((price - min) / span) * height;
      return `${index === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  const lastX = ((points.length - 1) / (points.length - 1)) * width;
  const lastY = height - ((points[points.length - 1] - min) / span) * height;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="mt-2 h-5 w-28 overflow-visible"
      role="img"
      aria-label={`Price history, ${points.length} readings`}
      preserveAspectRatio="none"
    >
      <path
        d={path}
        fill="none"
        className={`animate-draw ${falling ? "text-copper" : "text-ink-muted"}`}
        style={{
          // pathLength normalises the line to length 1, so the draw animation
          // needs no measuring.
          strokeDasharray: 1,
          ["--draw-length" as string]: 1,
        }}
        pathLength={1}
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
      <circle cx={lastX} cy={lastY} r={2} className={falling ? "fill-copper" : "fill-ink-muted"} />
    </svg>
  );
}
