"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { BellIcon, SearchIcon, SpinnerIcon, XIcon } from "@/components/icons";
import type { ProductMatchRow, WishItemRow } from "@/lib/captures";
import { CATEGORIES, CATEGORY_LABELS, formatPrice } from "@/lib/garments";
import { PRIORITY_LABELS } from "@/lib/captures";
import { deleteWant, fulfilWant, updateWant } from "../../actions";
import { dismissMatch, runDiscovery, setWatching } from "./actions";

/**
 * A want, and the pieces found for it.
 *
 * The search button carries its own cost on its face — grounded search is a
 * finite monthly allowance, and a button that quietly spends one every time
 * it's pressed will be pressed idly. It says when it last ran and refuses a
 * second run inside a minute.
 */

const inputClass =
  "w-full rounded-card border border-line bg-paper px-3 py-2 text-sm outline-none transition-colors focus:border-line-strong";

function WantFields({ want }: { want: WishItemRow }) {
  const [pending, startTransition] = useTransition();
  const [title, setTitle] = useState(want.title);
  const [category, setCategory] = useState(want.category ?? "");
  const [target, setTarget] = useState(
    want.target_price_cents ? String(Math.round(want.target_price_cents / 100)) : "",
  );
  const [priority, setPriority] = useState(String(want.priority));
  const [status, setStatus] = useState<string | null>(null);

  const save = () =>
    startTransition(async () => {
      const result = await updateWant(want.id, {
        title,
        category: category || null,
        targetPriceCents: target ? Math.round(Number(target) * 100) : null,
        priority: Number(priority),
      });
      setStatus(result.ok ? "Saved." : result.error);
    });

  return (
    <div className="rounded-card border border-line bg-surface p-5 shadow-card">
      <label className="block">
        <span className="label">What you&apos;re after</span>
        <input
          className={`${inputClass} mt-1`}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
      </label>

      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <label className="block">
          <span className="label">Category</span>
          <select
            className={`${inputClass} mt-1`}
            value={category}
            onChange={(event) => setCategory(event.target.value)}
          >
            <option value="">Unset</option>
            {CATEGORIES.map((entry) => (
              <option key={entry} value={entry}>
                {CATEGORY_LABELS[entry]}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="label">Target price</span>
          <div className="mt-1 flex items-center gap-1.5">
            <span className="text-sm text-ink-faint">$</span>
            <input
              type="number"
              min={0}
              inputMode="numeric"
              className={inputClass}
              value={target}
              onChange={(event) => setTarget(event.target.value)}
            />
          </div>
        </label>

        <label className="block">
          <span className="label">How much you want it</span>
          <select
            className={`${inputClass} mt-1`}
            value={priority}
            onChange={(event) => setPriority(event.target.value)}
          >
            {[1, 2, 3, 4, 5].map((level) => (
              <option key={level} value={level}>
                {PRIORITY_LABELS[level]}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="mt-4 flex items-center gap-3">
        <button
          type="button"
          disabled={pending}
          onClick={save}
          className="rounded-card bg-accent px-3.5 py-2 text-sm font-medium text-accent-ink transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {pending ? "Saving…" : "Save"}
        </button>
        {status ? <span className="text-xs text-ink-muted">{status}</span> : null}
      </div>

      <p className="mt-3 text-xs text-ink-faint">
        The category picks which of your spend ceilings applies to the search.
      </p>
    </div>
  );
}

export function WantPanel({
  want,
  matches,
  lastRunLabel,
}: {
  want: WishItemRow;
  matches: ProductMatchRow[];
  lastRunLabel: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const search = () =>
    startTransition(async () => {
      setError(null);
      setMessage(null);
      const result = await runDiscovery(want.id);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      const { found, proposed } = result.data;
      setMessage(
        found === 0
          ? proposed === 0
            ? "The search found nothing real for this. Try describing it differently."
            : `All ${proposed} suggestions turned out to be dead links or over your ceiling.`
          : `${found} found${proposed > found ? `, from ${proposed} suggested — the rest didn't check out` : ""}.`,
      );
    });

  return (
    <div className="space-y-4">
      <WantFields want={want} />

      <div className="rounded-card border border-line bg-surface p-5 shadow-card">
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={pending}
            onClick={search}
            className="flex items-center gap-2 rounded-card bg-accent px-3.5 py-2 text-sm font-medium text-accent-ink transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {pending ? <SpinnerIcon className="size-4" /> : <SearchIcon className="size-4" />}
            {pending ? "Searching the web…" : matches.length > 0 ? "Search again" : "Find pieces"}
          </button>
          <span className="text-xs text-ink-faint">
            {lastRunLabel ? `Last searched ${lastRunLabel}.` : "Never searched."} Uses one
            of the month&apos;s grounded searches.
          </span>
        </div>

        {message ? <p className="mt-3 text-sm text-ink-muted">{message}</p> : null}
        {error ? <p className="mt-3 text-sm text-danger">{error}</p> : null}
        {pending ? (
          <p className="mt-2 text-xs text-ink-faint">
            Searching, then opening each result to check it&apos;s real and read its
            price. Takes up to a minute.
          </p>
        ) : null}
      </div>

      {matches.length > 0 ? (
        <ul className="space-y-3">
          {matches.map((match) => (
            <MatchCard key={match.id} match={match} />
          ))}
        </ul>
      ) : null}

      <div className="flex items-center gap-4 pt-2">
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const result = await fulfilWant(want.id);
              if (result.ok) router.push("/inbox");
              else setError(result.error);
            })
          }
          className="text-xs text-ink-muted underline underline-offset-4 transition-colors hover:text-ink disabled:opacity-50"
        >
          I bought this
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const result = await deleteWant(want.id);
              if (result.ok) router.push("/inbox");
              else setError(result.error);
            })
          }
          className="text-xs text-ink-muted underline underline-offset-4 transition-colors hover:text-danger disabled:opacity-50"
        >
          Delete this want
        </button>
      </div>
    </div>
  );
}

function MatchCard({ match }: { match: ProductMatchRow }) {
  const [pending, startTransition] = useTransition();
  const [watching, setWatchingState] = useState(match.watching);
  const [gone, setGone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (gone) return null;

  return (
    <li className="flex gap-4 rounded-card border border-line bg-surface p-4 shadow-card">
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
          {match.price_cents
            ? ` · ${formatPrice(match.price_cents, match.currency)}`
            : " · no price published"}
        </p>

        <div className="mt-2.5 flex items-center gap-3">
          {match.unwatchable ? (
            <span className="text-xs text-ink-faint">Can&apos;t be watched</span>
          ) : (
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  setError(null);
                  const result = await setWatching(match.id, !watching);
                  if (result.ok) setWatchingState(result.data);
                  else setError(result.error);
                })
              }
              className={`flex items-center gap-1.5 text-xs underline underline-offset-4 transition-colors ${
                watching ? "text-ink" : "text-ink-muted hover:text-ink"
              } disabled:opacity-50`}
            >
              <BellIcon className="size-3.5" />
              {watching ? "Watching the price" : "Watch the price"}
            </button>
          )}

          <button
            type="button"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const result = await dismissMatch(match.id);
                if (result.ok) setGone(true);
                else setError(result.error);
              })
            }
            className="flex items-center gap-1 text-xs text-ink-muted underline underline-offset-4 transition-colors hover:text-danger disabled:opacity-50"
          >
            <XIcon className="size-3.5" />
            Not this
          </button>
        </div>

        {error ? <p className="mt-1.5 text-xs text-danger">{error}</p> : null}
      </div>
    </li>
  );
}
