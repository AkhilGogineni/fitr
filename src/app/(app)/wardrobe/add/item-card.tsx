"use client";

import { useEffect, useRef, useState } from "react";

import {
  AlertIcon,
  CheckIcon,
  ClipboardIcon,
  LinkIcon,
  SpinnerIcon,
  TrashIcon,
} from "@/components/icons";
import {
  CATEGORIES,
  CATEGORY_LABELS,
  FORMALITY_LABELS,
  SEASONS,
  SEASON_LABELS,
  type Category,
  type GarmentTags,
  type Season,
} from "@/lib/garments";
import type { ItemPatch, WardrobeItem } from "@/lib/items";

/**
 * One row of the review grid.
 *
 * The whole point of this screen is correcting auto-tags faster than typing
 * them, so every control is one click or one keystroke from the last: category
 * and formality are pills rather than selects (no menu to open), seasons are
 * toggles, and the only free-text fields are the ones a model genuinely can't
 * know. Text commits on blur; everything else commits on click. There is no
 * save button, because a batch of 30 has no natural moment to press one.
 */

export type Ground = "surface" | "dark" | "check";

export const GROUND_CLASS: Record<Ground, string> = {
  surface: "bg-surface-sunk",
  dark: "bg-[#14130f]",
  check: "ground-check",
};

export type PendingEntry = {
  id: string;
  label: string;
  /**
   * `needs-image` is a link whose page was read successfully but rendered its
   * photo in the browser, so there was nothing for the server to fetch. It is a
   * waiting state, not a failure: everything scraped is kept and the card asks
   * for the one missing piece.
   */
  status: "queued" | "cutting" | "saving" | "needs-image" | "error";
  detail?: string;
  percent?: number;
  previewUrl?: string;
  error?: string;
  /** What was scraped, e.g. "Uniqlo · $49.90" — shown while waiting for a photo. */
  summary?: string;
};

const inputClass =
  "w-full rounded-sm border border-transparent bg-transparent px-1.5 py-1 text-sm " +
  // Placeholders carry the field's name here — there are no visible labels — so
  // they stay at full --ink-muted rather than being faded to decoration.
  "outline-none transition-colors placeholder:text-ink-muted hover:border-line " +
  "focus:border-line-strong focus:bg-surface";

/** A garment that hasn't finished the pipeline yet. */
export function PendingCard({
  entry,
  ground,
  receiving,
  onDismiss,
  onImage,
}: {
  entry: PendingEntry;
  ground: Ground;
  /** True for the one waiting card a paste will land in, so ⌘V is advertised once. */
  receiving?: boolean;
  onDismiss: () => void;
  /** Supplies the photo a `needs-image` card is waiting for. */
  onImage: (file: File) => void;
}) {
  const failed = entry.status === "error";
  const [dragging, setDragging] = useState(false);

  if (entry.status === "needs-image") {
    return (
      <li className="animate-rise rounded-card border border-line-strong bg-surface p-3 shadow-card">
        <label
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            const file = [...event.dataTransfer.files].find((f) =>
              f.type.startsWith("image/"),
            );
            if (file) onImage(file);
          }}
          className={`flex aspect-square cursor-pointer flex-col items-center justify-center gap-1.5 rounded border border-dashed px-3 text-center transition-colors ${
            dragging
              ? "border-line-strong bg-surface-sunk text-ink"
              : "border-line-strong text-ink-muted hover:text-ink"
          }`}
        >
          <input
            type="file"
            accept="image/*"
            className="sr-only"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) onImage(file);
              event.target.value = "";
            }}
          />
          <ClipboardIcon className="size-5" />
          <span className="text-sm text-ink">
            {receiving ? "Paste the photo — ⌘V" : "Needs a photo"}
          </span>
          <span className="text-xs leading-relaxed">
            Drop or click to choose one
          </span>
        </label>

        <p className="mt-2.5 truncate text-sm" title={entry.label}>
          {entry.label}
        </p>
        {entry.summary ? (
          <p className="label mt-0.5 truncate">{entry.summary}</p>
        ) : null}
        <p className="mt-1.5 text-xs leading-relaxed text-ink-muted">
          {entry.detail}
        </p>
        <button
          type="button"
          onClick={onDismiss}
          className="mt-2 w-full rounded-card border border-line py-1 text-xs text-ink-muted transition-colors hover:border-line-strong hover:text-ink"
        >
          Skip this one
        </button>
      </li>
    );
  }

  return (
    <li className="animate-rise rounded-card border border-line bg-surface p-3 shadow-card">
      <div
        className={`relative flex aspect-square items-center justify-center overflow-hidden rounded ${GROUND_CLASS[ground]}`}
      >
        {entry.previewUrl ? (
          // A cutout that exists only in this tab, as a blob: URL.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={entry.previewUrl}
            alt=""
            className="size-full object-contain p-3"
          />
        ) : failed ? (
          <AlertIcon className="size-5 text-danger" />
        ) : (
          <SpinnerIcon className="size-5 text-ink-muted" />
        )}
      </div>

      <p className="mt-2.5 truncate text-sm" title={entry.label}>
        {entry.label}
      </p>

      {failed ? (
        <>
          <p className="mt-1 text-xs leading-relaxed text-danger">{entry.error}</p>
          <button
            type="button"
            onClick={onDismiss}
            className="mt-2 w-full rounded-card border border-line py-1 text-xs text-ink-muted transition-colors hover:border-line-strong hover:text-ink"
          >
            Dismiss
          </button>
        </>
      ) : (
        <div className="mt-1.5">
          <p className="text-xs text-ink-muted">
            {entry.status === "queued"
              ? "Waiting"
              : entry.status === "cutting"
                ? (entry.detail ?? "Cutting out")
                : "Saving"}
            {entry.percent !== undefined ? ` · ${entry.percent}%` : ""}
          </p>
          <div className="mt-1.5 h-0.5 overflow-hidden rounded-full bg-surface-sunk">
            <div
              className={
                entry.percent !== undefined
                  ? "h-full bg-ink-muted transition-[width] duration-300"
                  : "h-full w-1/3 animate-slide bg-ink-muted"
              }
              style={entry.percent !== undefined ? { width: `${entry.percent}%` } : undefined}
            />
          </div>
        </div>
      )}
    </li>
  );
}

export function ItemCard({
  item,
  imageUrl,
  ground,
  note,
  saving,
  onSave,
  onArchive,
}: {
  item: WardrobeItem;
  imageUrl: string;
  ground: Ground;
  /** e.g. why the auto-tagger didn't run for this one. */
  note?: string;
  saving?: boolean;
  onSave: (patch: ItemPatch) => void;
  onArchive: () => void;
}) {
  const [draft, setDraft] = useState({
    brand: item.brand ?? "",
    subcategory: item.subcategory ?? "",
    colors: item.colors.join(", "),
    material: item.material ?? "",
    pattern: item.pattern ?? "",
    price: item.purchase_price_cents ? String(item.purchase_price_cents / 100) : "",
  });

  // The row can change underneath the draft — a save round-trips through the
  // server and comes back coerced (colours trimmed to three, price rounded).
  const itemRef = useRef(item);
  useEffect(() => {
    itemRef.current = item;
  }, [item]);

  const commitText = (field: keyof typeof draft) => {
    const value = draft[field].trim();
    const current = itemRef.current;

    switch (field) {
      case "brand":
        if (value !== (current.brand ?? "")) onSave({ brand: value || null });
        break;
      case "subcategory":
        if (value !== (current.subcategory ?? "")) onSave({ subcategory: value || null });
        break;
      case "material":
        if (value !== (current.material ?? "")) onSave({ material: value || null });
        break;
      case "pattern":
        if (value !== (current.pattern ?? "")) onSave({ pattern: value || null });
        break;
      case "colors": {
        const colors = value
          .split(",")
          .map((color) => color.trim())
          .filter(Boolean);
        if (colors.join(", ") !== current.colors.join(", ")) onSave({ colors });
        break;
      }
      case "price": {
        const cents = value === "" ? null : Math.round(Number(value) * 100);
        if (cents !== current.purchase_price_cents) {
          onSave({ purchasePriceCents: Number.isFinite(cents) ? cents : null });
        }
        break;
      }
    }
  };

  const toggleSeason = (season: Season) => {
    const seasons = item.seasons.includes(season)
      ? item.seasons.filter((s) => s !== season)
      : [...item.seasons, season];
    onSave({ seasons: seasons as GarmentTags["seasons"] });
  };

  return (
    <li
      className={`animate-rise rounded-card border bg-surface p-3 shadow-card transition-colors ${
        item.needs_review ? "border-line-strong" : "border-line"
      }`}
    >
      <div
        className={`relative aspect-square overflow-hidden rounded ${GROUND_CLASS[ground]}`}
      >
        {/* Either an R2 URL or a blob: URL for a cutout made moments ago in
            this tab. The second has nothing to optimise and no loader would
            accept it, so both take the plain element. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={imageUrl}
          alt={item.subcategory ?? CATEGORY_LABELS[item.category as Category] ?? "Garment"}
          loading="lazy"
          className="size-full object-contain p-3"
        />

        {item.needs_review ? (
          <span className="absolute left-2 top-2 rounded-full bg-accent px-2 py-0.5 text-[0.625rem] font-medium tracking-wide text-accent-ink">
            Needs a look
          </span>
        ) : null}

        <div className="absolute right-2 top-2 flex items-center gap-1.5">
          {saving ? <SpinnerIcon className="size-3.5 text-ink-muted" /> : null}
          {item.source_url ? (
            <a
              href={item.source_url}
              target="_blank"
              rel="noreferrer noopener"
              title="Open the product page"
              className="rounded-full bg-surface/90 p-1.5 text-ink-muted transition-colors hover:text-ink"
            >
              <LinkIcon className="size-3.5" label="Product page" />
            </a>
          ) : null}
          <button
            type="button"
            onClick={onArchive}
            title="Archive this piece"
            className="rounded-full bg-surface/90 p-1.5 text-ink-muted transition-colors hover:text-danger"
          >
            <TrashIcon className="size-3.5" label="Archive" />
          </button>
        </div>
      </div>

      {note ? (
        <p className="mt-2.5 flex items-start gap-1.5 text-xs leading-relaxed text-ink-muted">
          <AlertIcon className="mt-px size-3.5 shrink-0" />
          {note}
        </p>
      ) : null}

      <div className="mt-2.5 space-y-2">
        <div className="flex gap-1.5">
          <input
            value={draft.brand}
            onChange={(event) => setDraft({ ...draft, brand: event.target.value })}
            onBlur={() => commitText("brand")}
            placeholder="Brand"
            aria-label="Brand"
            className={`${inputClass} font-medium`}
          />
          <input
            value={draft.subcategory}
            onChange={(event) => setDraft({ ...draft, subcategory: event.target.value })}
            onBlur={() => commitText("subcategory")}
            placeholder="What is it?"
            aria-label="Garment"
            className={inputClass}
          />
        </div>

        <div className="flex flex-wrap gap-1" role="group" aria-label="Category">
          {CATEGORIES.map((category) => (
            <button
              key={category}
              type="button"
              aria-pressed={item.category === category}
              onClick={() => onSave({ category })}
              className={`rounded-full px-2 py-0.5 text-xs transition-colors ${
                item.category === category
                  ? "bg-accent text-accent-ink"
                  : "bg-surface-sunk text-ink-muted hover:text-ink"
              }`}
            >
              {CATEGORY_LABELS[category]}
            </button>
          ))}
        </div>

        <div className="flex gap-1.5">
          <input
            value={draft.colors}
            onChange={(event) => setDraft({ ...draft, colors: event.target.value })}
            onBlur={() => commitText("colors")}
            placeholder="Colours"
            aria-label="Colours, comma separated"
            className={inputClass}
          />
          <input
            value={draft.material}
            onChange={(event) => setDraft({ ...draft, material: event.target.value })}
            onBlur={() => commitText("material")}
            placeholder="Material"
            aria-label="Material"
            className={inputClass}
          />
        </div>

        <div className="flex gap-1.5">
          <input
            value={draft.pattern}
            onChange={(event) => setDraft({ ...draft, pattern: event.target.value })}
            onBlur={() => commitText("pattern")}
            placeholder="Pattern"
            aria-label="Pattern"
            className={inputClass}
          />
          <input
            value={draft.price}
            onChange={(event) => setDraft({ ...draft, price: event.target.value })}
            onBlur={() => commitText("price")}
            inputMode="decimal"
            placeholder="Paid"
            aria-label="Price paid"
            className={inputClass}
          />
        </div>

        <div className="flex items-center justify-between gap-2 pt-0.5">
          <div className="flex gap-1" role="group" aria-label="Formality">
            {[1, 2, 3, 4, 5].map((level) => (
              <button
                key={level}
                type="button"
                title={FORMALITY_LABELS[level]}
                aria-label={FORMALITY_LABELS[level]}
                aria-pressed={item.formality === level}
                onClick={() => onSave({ formality: level })}
                className={`size-5 rounded-full text-[0.625rem] transition-colors ${
                  item.formality === level
                    ? "bg-accent text-accent-ink"
                    : "bg-surface-sunk text-ink-muted hover:text-ink"
                }`}
              >
                {level}
              </button>
            ))}
          </div>

          <div className="flex gap-1" role="group" aria-label="Seasons">
            {SEASONS.map((season) => (
              <button
                key={season}
                type="button"
                title={SEASON_LABELS[season]}
                aria-label={SEASON_LABELS[season]}
                aria-pressed={item.seasons.includes(season)}
                onClick={() => toggleSeason(season)}
                className={`rounded-full px-1.5 py-0.5 text-[0.625rem] uppercase tracking-wide transition-colors ${
                  item.seasons.includes(season)
                    ? "bg-accent text-accent-ink"
                    : "bg-surface-sunk text-ink-muted hover:text-ink"
                }`}
              >
                {SEASON_LABELS[season].slice(0, 3)}
              </button>
            ))}
          </div>
        </div>

        {item.needs_review ? (
          <button
            type="button"
            onClick={() => onSave({})}
            className="flex w-full items-center justify-center gap-1.5 rounded-card border border-line py-1.5 text-xs text-ink-muted transition-colors hover:border-line-strong hover:text-ink"
          >
            <CheckIcon className="size-3.5" />
            Tags are right
          </button>
        ) : null}
      </div>
    </li>
  );
}
