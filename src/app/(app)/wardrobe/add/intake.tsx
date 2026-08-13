"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { AlertIcon, CameraIcon, CheckIcon, LinkIcon, SpinnerIcon } from "@/components/icons";
import type { GarmentTags } from "@/lib/garments";
import {
  preloadCutter,
  removeBackground,
  requestTags,
  type Backend,
  type CutoutProgress,
} from "@/lib/intake/background-removal";
import type { ProductMetadata } from "@/lib/intake/product-page";
import { uploadToR2 } from "@/lib/intake/upload";
import type { ItemPatch, WardrobeItem } from "@/lib/items";
import { archiveItem, confirmItems, createItem, updateItem } from "../actions";
import { ItemCard, PendingCard, type Ground, type PendingEntry } from "./item-card";

/**
 * The intake screen.
 *
 * Two ways in, one pipeline out. A pasted product URL and a photo from the
 * camera converge at the same place — a transparent cutout in the browser —
 * because an outfit collage cannot use a garment that still has a white
 * rectangle behind it, and a retailer's photo on white is exactly that.
 *
 * Cutting is serialised while everything else runs concurrently. Inference
 * saturates the GPU, so two at once is slower than one after another; uploads
 * and tagging are network-bound, so they overlap with the next garment's cut.
 * On a batch of twenty that is the difference between watching one progress bar
 * and watching twenty.
 *
 * Rows are written as soon as their cutout lands, carrying `needs_review`
 * until someone has looked. Losing a browser tab twelve photos into a session
 * should cost twelve seconds, not twelve minutes.
 */

type SavedItem = WardrobeItem & {
  imageUrl: string;
  /** Why this row still wants attention, e.g. the tagger was unavailable. */
  note?: string;
};

type ModelState =
  | { status: "loading"; percent?: number }
  | { status: "ready"; backend: Backend }
  | { status: "error"; message: string };

type Seed = Partial<ProductMetadata> & { hint?: string | null };

const GROUNDS: { value: Ground; label: string }[] = [
  { value: "surface", label: "Paper" },
  { value: "dark", label: "Dark" },
  { value: "check", label: "Grid" },
];

export function Intake({ initialItems }: { initialItems: SavedItem[] }) {
  const [items, setItems] = useState<SavedItem[]>(initialItems);
  const [pending, setPending] = useState<PendingEntry[]>([]);
  const [ground, setGround] = useState<Ground>("surface");
  // Starts as "loading" rather than "idle": the effect below fires on mount and
  // begins the download immediately, so idle is a state this screen never shows.
  const [model, setModel] = useState<ModelState>({ status: "loading" });
  const [urlText, setUrlText] = useState("");
  const [dragging, setDragging] = useState(false);
  const [saving, setSaving] = useState<string[]>([]);
  const [banner, setBanner] = useState<string | null>(null);

  const objectUrls = useRef<string[]>([]);
  const queue = useRef<Promise<unknown>>(Promise.resolve());

  /**
   * The weights are ~44MB and cached by the browser after the first visit.
   * Starting the download on arrival means the first garment isn't the one that
   * waits for it — and this page has no other purpose, so there is nothing
   * speculative about it.
   */
  useEffect(() => {
    let cancelled = false;

    preloadCutter((progress) => {
      if (!cancelled && progress.stage === "loading-model") {
        setModel({ status: "loading", percent: progress.percent });
      }
    })
      .then((backend) => {
        if (!cancelled) setModel({ status: "ready", backend });
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setModel({
            status: "error",
            message:
              error instanceof Error ? error.message : "The cutter failed to load.",
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const urls = objectUrls.current;
    return () => urls.forEach(URL.revokeObjectURL);
  }, []);

  const patchPending = useCallback((id: string, patch: Partial<PendingEntry>) => {
    setPending((entries) =>
      entries.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry)),
    );
  }, []);

  const dropPending = useCallback((id: string) => {
    setPending((entries) => entries.filter((entry) => entry.id !== id));
  }, []);

  /** Cut → upload → tag → insert, for one image from either path. */
  const process = useCallback(
    async (id: string, source: Blob, seed: Seed | null) => {
      patchPending(id, { status: "cutting", detail: "Cutting out", percent: undefined });

      const cut = await removeBackground(source, (progress: CutoutProgress) => {
        patchPending(id, {
          detail:
            progress.stage === "loading-model"
              ? "Loading the cutter"
              : progress.stage === "encoding"
                ? "Finishing"
                : "Cutting out",
          percent: progress.percent,
        });
      });

      const previewUrl = URL.createObjectURL(cut.cutout);
      objectUrls.current.push(previewUrl);
      patchPending(id, { status: "saving", previewUrl, detail: undefined, percent: undefined });

      const [cutoutUpload, originalUpload, tagResult] = await Promise.all([
        uploadToR2(cut.cutout, "cutout"),
        uploadToR2(cut.original, "original"),
        requestTags(cut.forTagging, seed?.hint ?? null),
      ]);

      const tagged = "tags" in tagResult ? tagResult.tags : null;
      const note = "error" in tagResult ? tagResult.error : undefined;

      // The retailer knows its own product better than a vision model does, so
      // scraped fields win where both have an opinion.
      const tags: Partial<GarmentTags> = {
        ...(tagged ?? {}),
        material: seed?.material ?? tagged?.material ?? null,
        colors: tagged?.colors?.length ? tagged.colors : (seed?.colors ?? []),
        subcategory: tagged?.subcategory ?? seed?.title ?? null,
      };

      const result = await createItem({
        imageCutoutKey: cutoutUpload.key,
        imageOriginalKey: originalUpload.key,
        sourceUrl: seed?.sourceUrl ?? null,
        // `items` stores cents but no currency, so a price scraped in EUR would
        // read as dollars. The source URL is kept alongside it, which is enough
        // to settle any argument until a second currency actually turns up.
        purchasePriceCents: seed?.priceCents ?? null,
        brand: seed?.brand ?? null,
        tags,
      });

      if (!result.ok) {
        patchPending(id, { status: "error", error: result.error });
        return;
      }

      dropPending(id);
      setItems((current) => [{ ...result.data, imageUrl: previewUrl, note }, ...current]);
    },
    [dropPending, patchPending],
  );

  /** Serialises the GPU-bound step; failures stay on their own card. */
  const enqueue = useCallback(
    (id: string, task: () => Promise<void>) => {
      queue.current = queue.current.then(task).catch((error: unknown) => {
        patchPending(id, {
          status: "error",
          error: error instanceof Error ? error.message : "Something went wrong.",
        });
      });
    },
    [patchPending],
  );

  const addFiles = useCallback(
    (files: File[]) => {
      const images = files.filter((file) => file.type.startsWith("image/"));
      if (images.length === 0) return;

      for (const file of images) {
        const id = crypto.randomUUID();
        setPending((entries) => [
          ...entries,
          { id, label: file.name.replace(/\.[^.]+$/, ""), status: "queued" },
        ]);
        enqueue(id, () => process(id, file, null));
      }
    },
    [enqueue, process],
  );

  const importUrls = useCallback(() => {
    const urls = urlText
      .split(/\s+/)
      .map((entry) => entry.trim())
      .filter((entry) => /^https?:\/\//i.test(entry));

    if (urls.length === 0) {
      setBanner("Paste a link starting with http:// or https://.");
      return;
    }

    setBanner(null);
    setUrlText("");

    for (const url of urls) {
      const id = crypto.randomUUID();
      let label = url;
      try {
        label = new URL(url).hostname.replace(/^www\./, "");
      } catch {
        // Already validated by the regex; the hostname is a nicety.
      }

      setPending((entries) => [...entries, { id, label, status: "queued" }]);

      enqueue(id, async () => {
        patchPending(id, { status: "cutting", detail: "Reading the page" });

        const response = await fetch("/api/import/url", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ url }),
        });
        const payload = (await response.json().catch(() => ({}))) as {
          product?: ProductMetadata;
          error?: string;
        };

        if (!response.ok || !payload.product) {
          patchPending(id, {
            status: "error",
            error: payload.error ?? "Couldn't read that page.",
          });
          return;
        }

        const product = payload.product;
        patchPending(id, {
          label: product.title ?? label,
          detail: "Fetching the photo",
        });

        // Through our own origin: a retailer CDN sends no CORS headers, and a
        // tainted canvas can't be read back as a cutout.
        const image = await fetch(
          `/api/import/image?url=${encodeURIComponent(product.imageUrl!)}`,
        );
        if (!image.ok) {
          const { error } = (await image.json().catch(() => ({}))) as { error?: string };
          patchPending(id, { status: "error", error: error ?? "Couldn't fetch the photo." });
          return;
        }

        await process(id, await image.blob(), {
          ...product,
          hint: [product.brand, product.title].filter(Boolean).join(" ") || null,
        });
      });
    }
  }, [enqueue, patchPending, process, urlText]);

  const save = useCallback(async (id: string, patch: ItemPatch) => {
    setSaving((current) => [...current, id]);
    const result = await updateItem(id, patch);
    setSaving((current) => current.filter((entry) => entry !== id));

    if (!result.ok) {
      setBanner(result.error);
      return;
    }
    setItems((current) =>
      current.map((item) =>
        item.id === id ? { ...item, ...result.data, imageUrl: item.imageUrl } : item,
      ),
    );
  }, []);

  const archive = useCallback(async (id: string) => {
    const snapshot = items;
    setItems((current) => current.filter((item) => item.id !== id));
    const result = await archiveItem(id);
    if (!result.ok) {
      setItems(snapshot);
      setBanner(result.error);
    }
  }, [items]);

  const needsReview = items.filter((item) => item.needs_review);

  const acceptAll = useCallback(async () => {
    const ids = needsReview.map((item) => item.id);
    setItems((current) => current.map((item) => ({ ...item, needs_review: false })));
    const result = await confirmItems(ids);
    if (!result.ok) setBanner(result.error);
  }, [needsReview]);

  const busy = pending.length > 0;
  // Both paths end in the cutter, so a failed model load closes both doors.
  const cutterDown = model.status === "error";

  return (
    <div className="pb-24">
      <header className="mb-7 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="display text-2xl font-medium">Add to your wardrobe</h1>
          <p className="mt-1 text-sm text-ink-muted">
            Paste what you bought online. Photograph the rest.
          </p>
        </div>

        <div className="flex items-center gap-4">
          <ModelChip state={model} />
          <div
            className="flex items-center gap-1 rounded-full border border-line bg-surface p-0.5"
            role="group"
            aria-label="Check cutouts against"
          >
            {GROUNDS.map((option) => (
              <button
                key={option.value}
                type="button"
                aria-pressed={ground === option.value}
                onClick={() => setGround(option.value)}
                title={`Show cutouts on a ${option.label.toLowerCase()} ground`}
                className={`rounded-full px-2.5 py-1 text-xs transition-colors ${
                  ground === option.value
                    ? "bg-accent text-accent-ink"
                    : "text-ink-muted hover:text-ink"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      </header>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-card border border-line bg-surface p-4 shadow-card">
          <h2 className="flex items-center gap-2 text-sm font-medium">
            <LinkIcon className="size-4 text-ink-muted" />
            Product links
          </h2>
          <p className="mt-1 text-xs text-ink-muted">
            One per line. We read the brand, material, price and photo off the page.
          </p>
          <textarea
            value={urlText}
            onChange={(event) => setUrlText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) importUrls();
            }}
            rows={4}
            spellCheck={false}
            placeholder={"https://…\nhttps://…"}
            className="mt-3 w-full resize-y rounded-card border border-line bg-surface-sunk px-3 py-2 font-mono text-xs leading-relaxed outline-none transition-colors placeholder:text-ink-muted focus:border-line-strong"
          />
          <div className="mt-2.5 flex items-center justify-between gap-3">
            <span className="text-xs text-ink-muted">⌘↵ to import</span>
            <button
              type="button"
              onClick={importUrls}
              disabled={cutterDown}
              className="rounded-card bg-accent px-3.5 py-1.5 text-xs font-medium text-accent-ink transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              Import
            </button>
          </div>
        </section>

        <section
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            if (!cutterDown) addFiles([...event.dataTransfer.files]);
          }}
          className={`rounded-card border bg-surface p-4 shadow-card transition-colors ${
            dragging ? "border-line-strong bg-surface-sunk" : "border-line"
          }`}
        >
          <h2 className="flex items-center gap-2 text-sm font-medium">
            <CameraIcon className="size-4 text-ink-muted" />
            Photos
          </h2>
          <p className="mt-1 text-xs text-ink-muted">
            On a hanger, blank wall, same spot each time. Backgrounds come off here, on
            this machine.
          </p>

          <label
            className={`mt-3 flex h-[6.5rem] flex-col items-center justify-center gap-1.5 rounded-card border border-dashed text-center transition-colors ${
              cutterDown
                ? "cursor-not-allowed border-line text-ink-muted"
                : dragging
                  ? "cursor-pointer border-line-strong text-ink"
                  : "cursor-pointer border-line-strong text-ink-muted hover:text-ink"
            }`}
          >
            <input
              type="file"
              accept="image/*"
              multiple
              disabled={cutterDown}
              className="sr-only"
              onChange={(event) => {
                addFiles([...(event.target.files ?? [])]);
                event.target.value = "";
              }}
            />
            {cutterDown ? (
              <>
                <span className="text-sm">Nothing can be cut out right now</span>
                <span className="max-w-xs text-xs text-ink-muted">
                  {model.status === "error" ? model.message : null} Reload to try again.
                </span>
              </>
            ) : (
              <>
                <span className="text-sm">Drop photos, or choose files</span>
                <span className="text-xs text-ink-muted">
                  Twenty at a time is a comfortable batch
                </span>
              </>
            )}
          </label>
        </section>
      </div>

      {banner ? (
        <p
          role="alert"
          className="mt-4 flex items-start gap-2 rounded-card border border-line bg-surface px-3.5 py-2.5 text-sm text-danger"
        >
          <AlertIcon className="mt-0.5 size-4 shrink-0" />
          {banner}
        </p>
      ) : null}

      <section className="mt-9">
        <div className="mb-3.5 flex items-baseline justify-between">
          <h2 className="display text-lg font-medium">
            {busy ? "Coming in" : needsReview.length > 0 ? "Worth a look" : "Just added"}
          </h2>
          <p className="text-xs text-ink-muted">
            {items.length > 0
              ? `${items.length} ${items.length === 1 ? "piece" : "pieces"} in this session`
              : null}
          </p>
        </div>

        {items.length === 0 && pending.length === 0 ? (
          <div className="rounded-card border border-dashed border-line-strong bg-surface-sunk px-6 py-14 text-center">
            <p className="text-sm text-ink-muted">
              Nothing yet. Start with five links and five photographs — then decide
              which half of the closet is worth doing first.
            </p>
          </div>
        ) : (
          <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {pending.map((entry) => (
              <PendingCard
                key={entry.id}
                entry={entry}
                ground={ground}
                onDismiss={() => dropPending(entry.id)}
              />
            ))}
            {items.map((item) => (
              <ItemCard
                key={item.id}
                item={item}
                imageUrl={item.imageUrl}
                ground={ground}
                note={item.note}
                saving={saving.includes(item.id)}
                onSave={(patch) => save(item.id, patch)}
                onArchive={() => archive(item.id)}
              />
            ))}
          </ul>
        )}
      </section>

      {needsReview.length > 0 ? (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-paper/90 backdrop-blur">
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-3">
            <p className="text-sm">
              <span className="font-medium">{needsReview.length}</span>
              <span className="text-ink-muted">
                {" "}
                {needsReview.length === 1 ? "piece" : "pieces"} still unchecked
              </span>
            </p>
            <div className="flex items-center gap-3">
              <Link
                href="/wardrobe"
                className="text-xs text-ink-muted underline underline-offset-4 transition-colors hover:text-ink"
              >
                Back to wardrobe
              </Link>
              <button
                type="button"
                onClick={acceptAll}
                className="flex items-center gap-1.5 rounded-card bg-accent px-3.5 py-1.5 text-xs font-medium text-accent-ink transition-opacity hover:opacity-90"
              >
                <CheckIcon className="size-3.5" />
                Accept all tags
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ModelChip({ state }: { state: ModelState }) {
  if (state.status === "ready") {
    return (
      <span
        className="flex items-center gap-1.5 text-xs text-ink-muted"
        title={
          state.backend === "webgpu"
            ? "Running on WebGPU"
            : "This browser has no WebGPU, so cutting runs on the CPU and takes several seconds a garment."
        }
      >
        <span className="size-1.5 rounded-full bg-ink-muted" />
        Cutter ready · {state.backend === "webgpu" ? "WebGPU" : "CPU"}
      </span>
    );
  }

  if (state.status === "error") {
    return (
      <span className="flex items-center gap-1.5 text-xs text-danger" title={state.message}>
        <AlertIcon className="size-3.5" />
        Cutter unavailable
      </span>
    );
  }

  return (
    <span className="flex items-center gap-1.5 text-xs text-ink-muted">
      <SpinnerIcon className="size-3.5" />
      {state.status === "loading" && state.percent !== undefined
        ? `Loading the cutter · ${state.percent}%`
        : "Loading the cutter"}
    </span>
  );
}
