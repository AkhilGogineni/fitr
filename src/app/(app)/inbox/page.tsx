import Link from "next/link";

import { InboxIcon } from "@/components/icons";
import {
  CAPTURE_COLUMNS,
  CAPTURE_SOURCE_LABELS,
  WISH_COLUMNS,
  captureImage,
  type CaptureRow,
  type WishItemRow,
} from "@/lib/captures";
import { CATEGORY_LABELS, formatPrice, type Category } from "@/lib/garments";
import { btnTag } from "@/lib/ui";
import { publicUrlFor } from "@/lib/r2";
import { createClient } from "@/lib/supabase/server";
import { CaptureActions, PasteCapture } from "./triage";

export const metadata = { title: "Inbox" };

/**
 * The shopping inbox: things saved, and things wanted.
 *
 * Two lists on one page rather than two pages, because they're two states of
 * the same object and the whole flow is "this becomes that". A capture you keep
 * turns into a want a few centimetres further down the same screen, which makes
 * the relationship obvious without anyone having to explain it.
 *
 * Dismissed captures are counted but not listed. They're kept as rows so the
 * same TikTok doesn't come back for triage every time it's shared again — but
 * a triaged inbox that still shows everything you rejected isn't triaged.
 */
export default async function InboxPage() {
  const supabase = await createClient();

  const [{ data: captureRows, error }, { data: wantRows }] = await Promise.all([
    supabase.from("captures").select(CAPTURE_COLUMNS).order("created_at", { ascending: false }),
    supabase
      .from("wish_items")
      .select(WISH_COLUMNS)
      .is("fulfilled_at", null)
      .order("priority", { ascending: false })
      .order("created_at", { ascending: false }),
  ]);

  if (error) {
    return (
      <div className="rounded-card border border-line bg-surface p-6 shadow-card">
        <h1 className="display text-2xl">Inbox</h1>
        <p className="mt-2 text-sm text-danger">Could not load captures: {error.message}</p>
      </div>
    );
  }

  const captures = (captureRows ?? []) as CaptureRow[];
  const wants = (wantRows ?? []) as WishItemRow[];
  const waiting = captures.filter((capture) => capture.status === "new");
  const dismissed = captures.filter((capture) => capture.status === "dismissed").length;

  // Wants predate the mirrored-image habit or lost their picture along the
  // way; their source capture is the fallback, and it's already loaded.
  const captureById = new Map(captures.map((capture) => [capture.id, capture]));
  const wantImage = (want: WishItemRow) => {
    if (want.image_key) return publicUrlFor(want.image_key);
    const source = want.from_capture_id
      ? captureById.get(want.from_capture_id)
      : undefined;
    return source ? captureImage(source, publicUrlFor) : null;
  };

  return (
    <div>
      <header className="mb-6">
        <h1 className="display text-4xl">Inbox</h1>
        <p className="label nums mt-2">
          {waiting.length === 0
            ? "Nothing waiting."
            : `${waiting.length} to sort through`}
          {dismissed > 0 ? ` · ${dismissed} dismissed` : ""}
        </p>
      </header>

      <PasteCapture />

      {waiting.length > 0 ? (
        <ul className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {waiting.map((capture, index) => {
            const image = captureImage(capture, publicUrlFor);
            return (
              <li
                key={capture.id}
                className="animate-rise flex flex-col rounded-card border border-line bg-surface p-3 shadow-card transition-[box-shadow,border-color] duration-200 hover:-translate-y-0.5 hover:border-line-strong hover:shadow-lift"
                style={{ animationDelay: `${Math.min(index * 40, 400)}ms` }}
              >
                <div className="relative aspect-[4/5] overflow-hidden rounded bg-surface-sunk">
                  {image ? (
                    /* Plain img: these are remote retailer URLs and R2 objects,
                       neither of which should go through Vercel's metered
                       optimiser. Same call as the wardrobe grid. */
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={image}
                      alt={capture.title ?? "Saved item"}
                      loading="lazy"
                      className="size-full object-cover"
                    />
                  ) : (
                    <div className="flex size-full items-center justify-center text-ink-faint">
                      <InboxIcon className="size-6" />
                    </div>
                  )}
                  <span className="absolute left-2 top-2 rounded-full bg-paper/90 px-2 py-0.5 font-mono text-[0.625rem] uppercase tracking-wide backdrop-blur">
                    {CAPTURE_SOURCE_LABELS[capture.source]}
                  </span>
                </div>

                <p className="mt-2.5 line-clamp-2 text-sm">
                  {capture.title ?? capture.note ?? "Untitled"}
                </p>
                <p className="label nums mt-0.5 truncate">
                  {capture.brand ?? "—"}
                  {capture.price_cents
                    ? ` · ${formatPrice(capture.price_cents, capture.currency)}`
                    : ""}
                </p>

                {capture.source_url ? (
                  <a
                    href={capture.source_url}
                    target="_blank"
                    rel="noreferrer noopener"
                    className={`${btnTag} mt-1 truncate`}
                  >
                    Open original
                  </a>
                ) : null}

                <div className="mt-3">
                  <CaptureActions captureId={capture.id} dismissed={false} />
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="mt-6 rounded-card border border-dashed border-line-strong bg-surface-sunk px-6 py-12 text-center">
          <p className="mx-auto max-w-md text-sm leading-relaxed text-ink-muted">
            Nothing waiting. Share something to fitr from your phone, or paste a
            link above.
          </p>
          <p className="mt-2 font-mono text-xs text-ink-faint">
            Set the share sheet up once in{" "}
            <Link href="/settings" className="underline underline-offset-4">
              Settings
            </Link>
            .
          </p>
        </div>
      )}

      <section className="mt-12">
        <h2 className="display text-2xl">Wants</h2>
        <p className="label nums mt-2">
          {wants.length === 0
            ? "Nothing on the list yet."
            : `${wants.length} on the list`}
        </p>

        {wants.length > 0 ? (
          <ul className="mt-4 divide-y divide-line rounded-card border border-line bg-surface shadow-card">
            {wants.map((want, index) => {
              const image = wantImage(want);
              return (
                <li
                  key={want.id}
                  className="animate-rise"
                  style={{ animationDelay: `${Math.min(index * 50, 300)}ms` }}
                >
                  <Link
                    href={`/inbox/want/${want.id}`}
                    className="group flex items-center gap-4 px-4 py-3.5 transition-colors hover:bg-surface-sunk"
                  >
                    <div className="size-14 shrink-0 overflow-hidden rounded bg-surface-sunk">
                      {image ? (
                        /* eslint-disable-next-line @next/next/no-img-element */
                        <img
                          src={image}
                          alt=""
                          loading="lazy"
                          className="size-full object-cover"
                        />
                      ) : (
                        <div className="flex size-full items-center justify-center text-ink-faint">
                          <InboxIcon className="size-5" />
                        </div>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm">{want.title}</p>
                      <p className="label nums mt-0.5 truncate">
                        {want.category ? CATEGORY_LABELS[want.category as Category] : "Uncategorised"}
                        {want.target_price_cents
                          ? ` · under ${formatPrice(want.target_price_cents, null)}`
                          : ""}
                        {want.last_discovery_at ? "" : " · not searched yet"}
                      </p>
                      {want.fit_note ? (
                        <p className="mt-1 line-clamp-1 font-mono text-xs text-ink-faint">
                          {want.fit_note}
                        </p>
                      ) : null}
                    </div>
                    <span
                      aria-hidden
                      className="shrink-0 text-ink-faint transition-transform duration-200 group-hover:translate-x-1 group-hover:text-copper"
                    >
                      →
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        ) : null}
      </section>
    </div>
  );
}
