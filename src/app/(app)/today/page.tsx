import Link from "next/link";

import { CloudRainIcon, SunIcon } from "@/components/icons";
import { OutfitPreview } from "@/components/outfit-preview";
import { CATEGORY_LABELS, type Category } from "@/lib/garments";
import { OCCASIONS, OCCASION_LABELS, type Occasion } from "@/lib/outfits";
import { buildDailyView } from "@/lib/styling/daily";
import { DailyActions } from "./daily-actions";

export const metadata = { title: "Today · fitr" };

/**
 * The daily screen: one outfit, one sentence, two buttons.
 *
 * Phone-first and single-purpose. This is the screen used standing in front of
 * a wardrobe at 7am, which rules out anything that needs reading, scrolling, or
 * a decision beyond "yes" and "no" — and rules out a spinner, which is why the
 * work happens on the server before anything renders rather than in a client
 * effect after.
 *
 * The occasion lives in the URL rather than in client state. Switching it is a
 * link, so the whole screen stays a Server Component, ships no JavaScript for
 * the part that matters, and a particular morning's view is a shareable and
 * bookmarkable address.
 */
export default async function TodayPage({ searchParams }: PageProps<"/today">) {
  const params = await searchParams;
  const requested = Array.isArray(params.occasion) ? params.occasion[0] : params.occasion;
  const occasion: Occasion = (OCCASIONS as readonly string[]).includes(requested ?? "")
    ? (requested as Occasion)
    : "casual";

  const view = await buildDailyView(occasion);
  const { forecast, suggestion } = view;
  const wet = forecast !== null && forecast.precipChance >= 50;

  return (
    <div className="mx-auto max-w-lg">
      <header className="mb-6">
        <p className="label">
          {new Date().toLocaleDateString(undefined, {
            weekday: "long",
            day: "numeric",
            month: "long",
          })}
        </p>
        <h1 className="display mt-1 text-2xl font-medium">What to wear</h1>

        {forecast ? (
          <p className="mt-2 flex items-center gap-1.5 text-sm text-ink-muted">
            {wet ? (
              <CloudRainIcon className="size-4 shrink-0" />
            ) : (
              <SunIcon className="size-4 shrink-0" />
            )}
            <span>
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
      <nav className="mb-6 flex flex-wrap gap-1.5" aria-label="Occasion">
        {OCCASIONS.map((value) => {
          const active = value === occasion;
          return (
            <Link
              key={value}
              href={`/today?occasion=${value}`}
              aria-current={active ? "page" : undefined}
              className={
                active
                  ? "rounded-card bg-accent px-3 py-1.5 text-sm font-medium text-accent-ink"
                  : "rounded-card border border-line bg-surface px-3 py-1.5 text-sm text-ink-muted transition-colors hover:border-line-strong hover:text-ink"
              }
            >
              {OCCASION_LABELS[value]}
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
            className="mt-4 inline-block text-sm underline underline-offset-4"
          >
            Add pieces
          </Link>
        </div>
      ) : (
        <div className="animate-rise">
          <div className="rounded-card border border-line bg-surface p-4 shadow-card">
            <OutfitPreview slots={suggestion.slots} />
          </div>

          {/* The sentence, given the weight of a headline. It's the only part
              of this screen anyone actually reads. */}
          <p className="display mt-5 text-lg leading-snug">{suggestion.reason}</p>

          <ul className="mt-4 flex flex-wrap gap-1.5">
            {suggestion.items.map((item) => (
              <li
                key={item.id}
                className="rounded-full border border-line bg-surface px-2.5 py-1 text-xs text-ink-muted"
              >
                {item.brand ?? item.subcategory ?? CATEGORY_LABELS[item.category as Category]}
              </li>
            ))}
          </ul>

          <DailyActions
            suggestionId={suggestion.suggestionId}
            occasion={occasion}
            alreadyWorn={view.alreadyWornToday}
            outfitId={suggestion.outfitId}
          />

          <p className="label mt-6">
            {suggestion.pickedBy === "gemini" ? "Chosen from the shortlist" : "Chosen by the rules"}
            {suggestion.rank > 1 ? ` · attempt ${suggestion.rank}` : ""}
          </p>

          {suggestion.gripes.length > 0 ? (
            <p className="mt-1 text-xs text-ink-faint">
              Worth knowing: {suggestion.gripes.join(" ")}
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}
