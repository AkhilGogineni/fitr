"use client";

import { useState, useTransition } from "react";

import { CheckIcon, ClipboardIcon, RotateIcon, SpinnerIcon } from "@/components/icons";
import { CATEGORIES, CATEGORY_LABELS, type Category } from "@/lib/garments";
import { describePlace, type GeocodeHit } from "@/lib/weather";
import {
  regenerateCaptureToken,
  savePriceCeilings,
  saveLocation,
  searchPlaces,
} from "./actions";

/**
 * Settings, in the utility register: dense, plain, nothing decorative.
 *
 * Three unrelated things share this screen because each is a single field that
 * unblocks a whole feature, and three one-field screens would be worse than one
 * three-field screen. They're separated by cards rather than by tabs so all of
 * it is visible at once — this is a page you visit twice a year.
 */

function Card({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-card border border-line bg-surface p-5 shadow-card">
      <h2 className="text-sm font-medium">{title}</h2>
      <p className="mt-1 text-sm text-ink-muted">{description}</p>
      <div className="mt-4">{children}</div>
    </section>
  );
}

const inputClass =
  "w-full rounded-card border border-line bg-paper px-3 py-2 text-sm outline-none transition-colors focus:border-line-strong";

function LocationCard({
  initialName,
  initialLat,
  initialLon,
}: {
  initialName: string | null;
  initialLat: number | null;
  initialLon: number | null;
}) {
  const [pending, startTransition] = useTransition();
  const [query, setQuery] = useState(initialName ?? "");
  const [hits, setHits] = useState<GeocodeHit[] | null>(null);
  const [saved, setSaved] = useState(
    initialLat !== null && initialLon !== null ? (initialName ?? "Saved") : null,
  );
  const [error, setError] = useState<string | null>(null);

  const commit = (name: string, lat: number, lon: number) =>
    startTransition(async () => {
      const result = await saveLocation({ name, lat, lon });
      if (result.ok) {
        setSaved(name);
        setHits(null);
        setQuery(name);
      } else setError(result.error);
    });

  return (
    <Card
      title="Where you live"
      description="Used only for the forecast behind the daily suggestion. Stored to four decimal places, which is about a city block."
    >
      <div className="flex gap-2">
        <input
          className={inputClass}
          value={query}
          placeholder="Brooklyn, or a postcode"
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            startTransition(async () => {
              setError(null);
              const result = await searchPlaces(query);
              if (result.ok) setHits(result.data);
              else setError(result.error);
            });
          }}
        />
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              setError(null);
              const result = await searchPlaces(query);
              if (result.ok) setHits(result.data);
              else setError(result.error);
            })
          }
          className="shrink-0 rounded-card border border-line px-3 py-2 text-sm transition-colors hover:border-line-strong disabled:opacity-50"
        >
          {pending ? <SpinnerIcon className="size-4" /> : "Look up"}
        </button>
      </div>

      {/* The browser knows better than a typed place name on a phone, and worse
          than one on a laptop wired to an ISP three towns over — so it's an
          option rather than the default. */}
      <button
        type="button"
        className="mt-2 text-xs text-ink-muted underline underline-offset-4 transition-colors hover:text-ink"
        onClick={() => {
          setError(null);
          navigator.geolocation?.getCurrentPosition(
            (position) =>
              commit(
                "Current location",
                position.coords.latitude,
                position.coords.longitude,
              ),
            () => setError("The browser wouldn't share a location."),
            { timeout: 8_000 },
          );
        }}
      >
        Use my current location
      </button>

      {hits !== null ? (
        hits.length === 0 ? (
          <p className="mt-3 text-sm text-ink-muted">Nothing found for that.</p>
        ) : (
          <ul className="mt-3 divide-y divide-line rounded-card border border-line">
            {hits.map((hit) => (
              <li key={`${hit.latitude},${hit.longitude}`}>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() =>
                    commit(describePlace(hit), hit.latitude, hit.longitude)
                  }
                  className="w-full px-3 py-2 text-left text-sm transition-colors hover:bg-surface-sunk disabled:opacity-50"
                >
                  {describePlace(hit)}
                </button>
              </li>
            ))}
          </ul>
        )
      ) : null}

      {saved ? (
        <p className="mt-3 flex items-center gap-1.5 text-xs text-ink-muted">
          <CheckIcon className="size-3.5" /> Forecasting for {saved}
        </p>
      ) : null}
      {error ? <p className="mt-2 text-xs text-danger">{error}</p> : null}
    </Card>
  );
}

function CeilingsCard({ initial }: { initial: Record<Category, number> }) {
  const [pending, startTransition] = useTransition();
  const [values, setValues] = useState<Record<string, string>>(
    Object.fromEntries(
      CATEGORIES.map((category) => [category, String(Math.round(initial[category] / 100))]),
    ),
  );
  const [status, setStatus] = useState<string | null>(null);

  return (
    <Card
      title="What you'll pay"
      description="A ceiling per category, because one number for a t-shirt and a winter coat is no number at all. Discovery won't show you things above these."
    >
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {CATEGORIES.map((category) => (
          <label key={category} className="block">
            <span className="label">{CATEGORY_LABELS[category]}</span>
            <div className="mt-1 flex items-center gap-1.5">
              <span className="text-sm text-ink-faint">$</span>
              <input
                type="number"
                min={0}
                inputMode="numeric"
                className={inputClass}
                value={values[category] ?? ""}
                onChange={(event) =>
                  setValues((current) => ({ ...current, [category]: event.target.value }))
                }
              />
            </div>
          </label>
        ))}
      </div>

      <div className="mt-4 flex items-center gap-3">
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              setStatus(null);
              const cents = Object.fromEntries(
                CATEGORIES.map((category) => [
                  category,
                  // Entered in whole units, stored in cents — the same
                  // convention every price in this app uses.
                  Math.round(Number(values[category] ?? 0) * 100),
                ]),
              ) as Record<Category, number>;
              const result = await savePriceCeilings(cents);
              setStatus(result.ok ? "Saved." : result.error);
            })
          }
          className="rounded-card bg-accent px-3.5 py-2 text-sm font-medium text-accent-ink transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {pending ? "Saving…" : "Save ceilings"}
        </button>
        {status ? <span className="text-xs text-ink-muted">{status}</span> : null}
      </div>
    </Card>
  );
}

function TokenCard({ initialToken }: { initialToken: string | null }) {
  const [pending, startTransition] = useTransition();
  const [token, setToken] = useState(initialToken);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <Card
      title="Capture token"
      description="What the iOS Shortcut and the browser extension use to save things to your inbox. It can do exactly one thing — add a capture — and regenerating it revokes the old one immediately."
    >
      {token ? (
        <div className="flex items-center gap-2">
          <code className="flex-1 truncate rounded-card border border-line bg-surface-sunk px-3 py-2 font-mono text-xs">
            {token}
          </code>
          <button
            type="button"
            onClick={() => {
              navigator.clipboard?.writeText(token).then(
                () => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2_000);
                },
                () => setError("Couldn't reach the clipboard."),
              );
            }}
            className="shrink-0 rounded-card border border-line p-2 transition-colors hover:border-line-strong"
            aria-label="Copy token"
          >
            {copied ? <CheckIcon className="size-4" /> : <ClipboardIcon className="size-4" />}
          </button>
        </div>
      ) : (
        <p className="text-sm text-ink-muted">No token yet.</p>
      )}

      <button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            setError(null);
            const result = await regenerateCaptureToken();
            if (result.ok) setToken(result.data);
            else setError(result.error);
          })
        }
        className="mt-3 flex items-center gap-1.5 text-xs text-ink-muted underline underline-offset-4 transition-colors hover:text-ink disabled:opacity-50"
      >
        <RotateIcon className="size-3.5" />
        {token ? "Regenerate" : "Create a token"}
      </button>

      {error ? <p className="mt-2 text-xs text-danger">{error}</p> : null}
    </Card>
  );
}

export function SettingsForm({
  locationName,
  locationLat,
  locationLon,
  ceilings,
  captureToken,
}: {
  locationName: string | null;
  locationLat: number | null;
  locationLon: number | null;
  ceilings: Record<Category, number>;
  captureToken: string | null;
}) {
  return (
    <div className="space-y-4">
      <LocationCard
        initialName={locationName}
        initialLat={locationLat}
        initialLon={locationLon}
      />
      <CeilingsCard initial={ceilings} />
      <TokenCard initialToken={captureToken} />
    </div>
  );
}
