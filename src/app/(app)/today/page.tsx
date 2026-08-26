import Link from "next/link";

import { CloudRainIcon, SunIcon } from "@/components/icons";
import { OutfitPreview } from "@/components/outfit-preview";
import { CATEGORY_LABELS, type Category } from "@/lib/garments";
import {
  OCCASIONS,
  OCCASION_LABELS,
  VIBES,
  VIBE_LABELS,
  coerceVibe,
  type Occasion,
  type Vibe,
} from "@/lib/outfits";
import { btnTag, pillClass } from "@/lib/ui";
import { buildDailyView } from "@/lib/styling/daily";
import { DailyActions } from "./daily-actions";

export const metadata = { title: "Today" };

/**
 * The daily screen: one outfit, one sentence, two buttons.
 *
 * Phone-first and single-purpose. This is the screen used standing in front of
 * a wardrobe at 7am, which rules out anything that needs reading, scrolling, or
 * a decision beyond "yes" and "no" — and rules out a spinner, which is why the
 * work happens on the server before anything renders rather than in a client
 * effect after.
 *
 * The suggestion hangs as the day's work-ticket: a kraft tag, punched and
 * strung, with the outfit stamped on it and the reason typed beneath.
 *
 * The occasion and the vibe both live in the URL rather than in client state.
 * Switching either is a link, so the whole screen stays a Server Component,
 * ships no JavaScript for the part that matters, and a particular morning's
 * view is a shareable and bookmarkable address. The occasion says where you're
 * going; the vibe says how you want to read when you get there — and each is a
 * different composition, so they key the day's standing suggestion separately.
 */
export default async function TodayPage({ searchParams }: PageProps<"/today">) {
  const params = await searchParams;
  const requestedOccasion = Array.isArray(params.occasion)
    ? params.occasion[0]
    : params.occasion;
  const occasion: Occasion = (OCCASIONS as readonly string[]).includes(
    requestedOccasion ?? "",
  )
    ? (requestedOccasion as Occasion)
    : "casual";
  const requestedVibe = Array.isArray(params.vibe) ? params.vibe[0] : params.vibe;
  const vibe: Vibe = coerceVibe(requestedVibe);

  const view = await buildDailyView(occasion, { vibe });
  const { forecast, suggestion } = view;
  const wet = forecast !== null && forecast.precipChance >= 50;

  return (
    <div className="mx-auto max-w-lg">
      <header className="mb-6">
        <p className="label nums">
          {new Date().toLocaleDateString(undefined, {
            weekday: "long",
            day: "numeric",
            month: "long",
          })}
        </p>
        <h1 className="display mt-1 text-4xl">What to wear</h1>

        {forecast ? (
          <p className="mt-2 flex items-center gap-1.5 text-sm text-ink-muted">
            {wet ? (
              <CloudRainIcon className="size-4 shrink-0 text-copper" />
            ) : (
              <SunIcon className="size-4 shrink-0 text-copper" />
            )}
            <span className="nums">
              {forecast.summary} · feels like {forecast.feelsLikeMin}–
              {forecast.feelsLikeMax}°C
              {forecast.placeName ? ` in ${forecast.placeName}` : ""}
            </span>
          </p>
        ) : (
          <p className="mt-2 text-sm text-ink-muted">
            {view.weatherNote}{" "}
            {!view.hasLocation ? (
              <Link href="/settings" className="underline underline-offset-4">
                Settings
              </Link>
            ) : null}
          </p>
        )}
      </header>

      {/* Occasion. Four links, current one filled — a segmented control that
          happens to be navigation, so it needs no client component. */}
      <nav className="mb-2 flex flex-wrap gap-1.5" aria-label="Occasion">
        {OCCASIONS.map((value) => {
          const active = value === occasion;
          return (
            <Link
              key={value}
              href={`/today?occasion=${value}&vibe=${vibe}`}
              aria-current={active ? "page" : undefined}
              className={
                active
                  ? `${pillClass} font-medium`
                  : `border border-line bg-surface ${pillClass}`
              }
            >
              {OCCASION_LABELS[value]}
            </Link>
          );
        })}
      </nav>

      {/* Vibe. Same trick as the occasion — links, not state — and the row
          only earns its place when it can actually change the answer, which
          "Any" alone cannot. */}
      <nav className="mb-7 flex flex-wrap gap-1.5" aria-label="Vibe">
        {VIBES.map((value) => {
          const active = value === vibe;
          if (active && value === "any") {
            return (
              <span key={value} className={`${pillClass} border border-copper/60 bg-surface`}>
                {VIBE_LABELS[value]}
              </span>
            );
          }
          return (
            <Link
              key={value}
              href={`/today?occasion=${occasion}&vibe=${value}`}
              aria-current={active ? "page" : undefined}
              className={`border bg-surface ${pillClass} ${
                active
                  ? "border-copper/60 font-medium text-copper"
                  : "border-line"
              }`}
            >
              {VIBE_LABELS[value]}
            </Link>
          );
        })}
      </nav>

      {view.blocked || !suggestion ? (
        <div className="rounded-card border border-dashed border-line-strong bg-surface-sunk px-6 py-14 text-center">
          <p className="mx-auto max-w-sm text-sm text-ink-muted">
            {view.blocked ?? "Nothing to suggest today."}
          </p>
          <Link
            href="/wardrobe/add"
            className={`${btnTag} mt-4 inline-block text-sm`}
          >
            Add pieces
          </Link>
        </div>
      ) : (
        <div className="animate-rise">
          {/* The work-ticket. */}
          <div className="relative rounded-card border border-line bg-surface p-5 pt-7 shadow-lift">
            <svg
              aria-hidden
              viewBox="0 0 120 64"
              className="absolute -top-[3.4rem] left-9 h-14 w-[7.5rem] text-line-strong"
              fill="none"
            >
              <path
                d="M112 0C88 30 52 50 23 61"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
            <span aria-hidden className="eyelet absolute left-12 top-3" />

            <OutfitPreview slots={suggestion.slots} />

            {/* The sentence, typed on the ticket. It's the only part of this
                screen anyone actually reads. */}
            <p className="mt-5 font-mono text-[0.9375rem] leading-relaxed">
              {suggestion.reason}
            </p>

            <ul className="mt-4 flex flex-wrap gap-1.5">
              {suggestion.items.map((item, index) => (
                <li
                  key={item.id}
                  className="animate-rise rounded-full border border-line bg-paper px-2.5 py-1 font-mono text-xs text-ink-muted"
                  style={{ animationDelay: `${Math.min(index * 60, 300)}ms` }}
                >
                  {item.brand ?? item.subcategory ?? CATEGORY_LABELS[item.category as Category]}
                </li>
              ))}
            </ul>
          </div>

          <DailyActions
            suggestionId={suggestion.suggestionId}
            occasion={occasion}
            vibe={vibe}
            alreadyWorn={view.alreadyWornToday}
            outfitId={suggestion.outfitId}
          />

          <p className="label mt-7">
            {suggestion.pickedBy === "gemini" ? "Chosen from the shortlist" : "Chosen by the rules"}
            {suggestion.rank > 1 ? ` · attempt ${suggestion.rank}` : ""}
          </p>

          {suggestion.gripes.length > 0 ? (
            <p className="mt-1 font-mono text-xs leading-relaxed text-ink-faint">
              Worth knowing: {suggestion.gripes.join(" ")}
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}
