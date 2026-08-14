"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { AlertIcon, PlusIcon, RotateIcon, TrashIcon } from "@/components/icons";
import { OutfitPreview } from "@/components/outfit-preview";
import {
  CATEGORIES,
  CATEGORY_LABELS,
  FORMALITY_LABELS,
  SEASONS,
  SEASON_LABELS,
  type Category,
  type Season,
} from "@/lib/garments";
import {
  CANVAS_ASPECT,
  OCCASIONS,
  OCCASION_LABELS,
  clamp,
  defaultTransform,
  describeGap,
  normaliseTransform,
  type GapSpec,
  type Occasion,
  type OutfitRow,
  type SlotTransform,
  type SlotView,
} from "@/lib/outfits";
import {
  addSlot,
  removeSlot,
  updateOutfit,
  updateSlotTransform,
} from "../actions";

/**
 * The outfit canvas.
 *
 * A flat-lay collage: pieces are placed, sized and rotated freely rather than
 * dropped into fixed sockets, because a real outfit isn't a form — a jacket
 * half-off the shoulder of a shirt reads as an outfit, and a grid of squares
 * doesn't.
 *
 * Three things this deliberately gets right rather than approximately:
 *
 * 1. **Pointer Events, not mouse events.** A trackpad, a stylus and a finger
 *    all produce the same code path, and `setPointerCapture` means a fast drag
 *    that leaves the canvas doesn't drop the piece where it last happened to be.
 * 2. **Placement is fractional.** Everything is stored as a fraction of the
 *    canvas, so the composition survives a window resize and renders identically
 *    in the 180px list thumbnail.
 * 3. **Local state leads, the server follows.** A drag updates React state at
 *    pointer speed and writes once on release. Awaiting a round trip per
 *    pointermove would make the canvas feel broken.
 */

export type WardrobePick = {
  id: string;
  category: Category;
  label: string;
  imageUrl: string;
};

type DragMode = "move" | "scale" | "rotate";

type DragState = {
  slotId: string;
  mode: DragMode;
  pointerId: number;
  startX: number;
  startY: number;
  startTransform: SlotTransform;
  /** Canvas geometry, read once at pointerdown rather than every move. */
  rect: DOMRect;
};

const NUDGE = 0.005;
const NUDGE_FAST = 0.025;

export function OutfitCanvas({
  outfit,
  initialSlots,
  wardrobe,
}: {
  outfit: OutfitRow;
  initialSlots: SlotView[];
  wardrobe: WardrobePick[];
}) {
  const [slots, setSlots] = useState<SlotView[]>(initialSlots);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [name, setName] = useState(outfit.name ?? "");
  const [occasion, setOccasion] = useState<Occasion | null>(outfit.occasion);
  const [seasons, setSeasons] = useState<string[]>(outfit.seasons);
  const [filter, setFilter] = useState<Category | "all">("all");
  const [gapOpen, setGapOpen] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);

  const canvasRef = useRef<HTMLDivElement>(null);
  const drag = useRef<DragState | null>(null);
  const saveTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  /**
   * Composing is a laptop job — the plan is explicit that the phone is for
   * capture and the daily suggestion, not for arranging a collage with fingers.
   * Rather than build a worse touch editor, a narrow screen gets the read-only
   * renderer, which is the same one the list and Phase 3 use.
   */
  const [readOnly, setReadOnly] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(max-width: 1023px)");
    const apply = () => setReadOnly(query.matches);
    apply();
    query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
  }, []);

  const selected = slots.find((slot) => slot.id === selectedId) ?? null;

  /** Writes a transform at most once per idle moment per slot. */
  const persist = useCallback((slotId: string, transform: SlotTransform) => {
    const timers = saveTimers.current;
    clearTimeout(timers.get(slotId));
    timers.set(
      slotId,
      setTimeout(async () => {
        const result = await updateSlotTransform(slotId, transform);
        if (!result.ok) setBanner(result.error);
      }, 400),
    );
  }, []);

  useEffect(() => {
    const timers = saveTimers.current;
    return () => timers.forEach(clearTimeout);
  }, []);

  const applyTransform = useCallback(
    (slotId: string, next: SlotTransform, save = true) => {
      setSlots((current) =>
        current.map((slot) => (slot.id === slotId ? { ...slot, transform: next } : slot)),
      );
      if (save) persist(slotId, next);
    },
    [persist],
  );

  const beginDrag = useCallback(
    (event: React.PointerEvent, slot: SlotView, mode: DragMode) => {
      if (readOnly) return;
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;

      event.preventDefault();
      event.stopPropagation();
      (event.target as Element).setPointerCapture(event.pointerId);

      setSelectedId(slot.id);
      drag.current = {
        slotId: slot.id,
        mode,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        startTransform: slot.transform,
        rect,
      };
    },
    [readOnly],
  );

  const onPointerMove = useCallback(
    (event: React.PointerEvent) => {
      const state = drag.current;
      if (!state || state.pointerId !== event.pointerId) return;

      const { rect, startTransform: start } = state;
      const centreX = rect.left + start.x * rect.width;
      const centreY = rect.top + start.y * rect.height;

      let next: SlotTransform;

      if (state.mode === "move") {
        next = {
          ...start,
          x: clamp(start.x + (event.clientX - state.startX) / rect.width, -0.2, 1.2),
          y: clamp(start.y + (event.clientY - state.startY) / rect.height, -0.2, 1.2),
        };
      } else if (state.mode === "scale") {
        // Scale by how much further the pointer is from the piece's centre than
        // when the drag started — the handle stays under the finger.
        const startDistance = Math.hypot(state.startX - centreX, state.startY - centreY);
        const distance = Math.hypot(event.clientX - centreX, event.clientY - centreY);
        const factor = startDistance > 4 ? distance / startDistance : 1;
        next = { ...start, scale: clamp(start.scale * factor, 0.05, 1.6) };
      } else {
        const startAngle = Math.atan2(state.startY - centreY, state.startX - centreX);
        const angle = Math.atan2(event.clientY - centreY, event.clientX - centreX);
        const degrees = ((angle - startAngle) * 180) / Math.PI;
        // Shift snaps to 15° so "straight" is reachable without fighting the mouse.
        const rotation = event.shiftKey
          ? Math.round((start.rotation + degrees) / 15) * 15
          : start.rotation + degrees;
        next = { ...start, rotation: clamp(rotation, -180, 180) };
      }

      applyTransform(state.slotId, next, false);
    },
    [applyTransform],
  );

  const endDrag = useCallback(
    (event: React.PointerEvent) => {
      const state = drag.current;
      if (!state || state.pointerId !== event.pointerId) return;
      drag.current = null;

      const slot = slots.find((entry) => entry.id === state.slotId);
      if (slot) persist(slot.id, slot.transform);
    },
    [persist, slots],
  );

  const remove = useCallback(async (slotId: string) => {
    setSlots((current) => current.filter((slot) => slot.id !== slotId));
    setSelectedId(null);
    const result = await removeSlot(slotId);
    if (!result.ok) setBanner(result.error);
  }, []);

  const restack = useCallback(
    (slotId: string, direction: 1 | -1) => {
      const zs = slots.map((slot) => slot.transform.z);
      const target = slots.find((slot) => slot.id === slotId);
      if (!target) return;
      const z =
        direction === 1
          ? Math.max(...zs) + 1
          : Math.max(0, Math.min(...zs) - 1);
      applyTransform(slotId, { ...target.transform, z });
    },
    [applyTransform, slots],
  );

  /** Arrow keys nudge, brackets restack, Delete removes. */
  useEffect(() => {
    if (readOnly) return;

    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA)$/.test(target.tagName)) return;
      if (!selectedId) return;

      const slot = slots.find((entry) => entry.id === selectedId);
      if (!slot) return;

      const step = event.shiftKey ? NUDGE_FAST : NUDGE;
      const moves: Record<string, [number, number]> = {
        ArrowLeft: [-step, 0],
        ArrowRight: [step, 0],
        ArrowUp: [0, -step],
        ArrowDown: [0, step],
      };

      if (moves[event.key]) {
        event.preventDefault();
        const [dx, dy] = moves[event.key];
        applyTransform(selectedId, {
          ...slot.transform,
          x: clamp(slot.transform.x + dx, -0.2, 1.2),
          y: clamp(slot.transform.y + dy, -0.2, 1.2),
        });
        return;
      }

      if (event.key === "Backspace" || event.key === "Delete") {
        event.preventDefault();
        void remove(selectedId);
      } else if (event.key === "Escape") {
        setSelectedId(null);
      } else if (event.key === "]") {
        restack(selectedId, 1);
      } else if (event.key === "[") {
        restack(selectedId, -1);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [applyTransform, readOnly, remove, restack, selectedId, slots]);

  const addPiece = useCallback(
    async (pick: WardrobePick) => {
      const taken = slots.filter((slot) => slot.layer === pick.category).length;
      const transform = defaultTransform(pick.category, taken);

      const result = await addSlot({
        outfitId: outfit.id,
        layer: pick.category,
        itemId: pick.id,
        transform,
      });

      if (!result.ok) {
        setBanner(result.error);
        return;
      }

      setSlots((current) => [
        ...current,
        {
          ...result.data,
          transform: normaliseTransform(result.data.transform, pick.category),
          imageUrl: pick.imageUrl,
          label: pick.label,
        },
      ]);
      setSelectedId(result.data.id);
    },
    [outfit.id, slots],
  );

  const addGap = useCallback(
    async (gap: GapSpec) => {
      const taken = slots.filter((slot) => slot.layer === gap.category).length;
      const result = await addSlot({
        outfitId: outfit.id,
        layer: gap.category,
        gapSpec: gap,
        transform: defaultTransform(gap.category, taken),
      });

      if (!result.ok) {
        setBanner(result.error);
        return;
      }

      setSlots((current) => [
        ...current,
        {
          ...result.data,
          transform: normaliseTransform(result.data.transform, gap.category),
          label: describeGap(gap, CATEGORY_LABELS[gap.category]),
        },
      ]);
      setSelectedId(result.data.id);
      setGapOpen(false);
    },
    [outfit.id, slots],
  );

  const saveMeta = useCallback(
    async (patch: { name?: string; occasion?: string | null; seasons?: string[] }) => {
      const result = await updateOutfit(outfit.id, patch);
      if (!result.ok) setBanner(result.error);
    },
    [outfit.id],
  );

  const visible =
    filter === "all" ? wardrobe : wardrobe.filter((pick) => pick.category === filter);
  const gapCount = slots.filter((slot) => slot.gap_spec).length;

  if (readOnly) {
    return (
      <div className="mx-auto max-w-sm">
        <OutfitPreview slots={slots} className="border border-line bg-surface" />
        <p className="mt-3 text-sm">{name || "Untitled outfit"}</p>
        <p className="label mt-0.5">
          {occasion ? OCCASION_LABELS[occasion] : "No occasion"}
          {gapCount > 0 ? ` · ${gapCount} gap${gapCount === 1 ? "" : "s"}` : ""}
        </p>
        <p className="mt-4 text-xs leading-relaxed text-ink-muted">
          Arranging an outfit wants a pointer and room to work, so editing lives on
          the laptop. This is the view.
        </p>
      </div>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[19rem_minmax(0,1fr)]">
      <aside className="order-2 lg:order-1">
        <div className="rounded-card border border-line bg-surface p-3 shadow-card">
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            onBlur={() => saveMeta({ name })}
            placeholder="Name this outfit"
            aria-label="Outfit name"
            className="w-full rounded-sm border border-transparent bg-transparent px-1.5 py-1 text-sm font-medium outline-none transition-colors placeholder:text-ink-muted hover:border-line focus:border-line-strong"
          />

          <div className="mt-2 flex flex-wrap gap-1" role="group" aria-label="Occasion">
            {OCCASIONS.map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={occasion === value}
                onClick={() => {
                  const next = occasion === value ? null : value;
                  setOccasion(next);
                  void saveMeta({ occasion: next });
                }}
                className={`rounded-full px-2 py-0.5 text-xs transition-colors ${
                  occasion === value
                    ? "bg-accent text-accent-ink"
                    : "bg-surface-sunk text-ink-muted hover:text-ink"
                }`}
              >
                {OCCASION_LABELS[value]}
              </button>
            ))}
          </div>

          <div className="mt-1.5 flex gap-1" role="group" aria-label="Seasons">
            {SEASONS.map((season) => (
              <button
                key={season}
                type="button"
                aria-label={SEASON_LABELS[season]}
                aria-pressed={seasons.includes(season)}
                onClick={() => {
                  const next = seasons.includes(season)
                    ? seasons.filter((entry) => entry !== season)
                    : [...seasons, season as Season];
                  setSeasons(next);
                  void saveMeta({ seasons: next });
                }}
                className={`rounded-full px-1.5 py-0.5 text-[0.625rem] uppercase tracking-wide transition-colors ${
                  seasons.includes(season)
                    ? "bg-accent text-accent-ink"
                    : "bg-surface-sunk text-ink-muted hover:text-ink"
                }`}
              >
                {SEASON_LABELS[season].slice(0, 3)}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-4 rounded-card border border-line bg-surface p-3 shadow-card">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium">Your wardrobe</h2>
            <button
              type="button"
              onClick={() => setGapOpen((open) => !open)}
              className="flex items-center gap-1 text-xs text-ink-muted transition-colors hover:text-ink"
            >
              <PlusIcon className="size-3.5" />
              Add a gap
            </button>
          </div>

          {gapOpen ? <GapForm onAdd={addGap} onCancel={() => setGapOpen(false)} /> : null}

          <div className="mt-2.5 flex flex-wrap gap-1">
            <FilterPill active={filter === "all"} onClick={() => setFilter("all")}>
              All
            </FilterPill>
            {CATEGORIES.map((category) => (
              <FilterPill
                key={category}
                active={filter === category}
                onClick={() => setFilter(category)}
              >
                {CATEGORY_LABELS[category]}
              </FilterPill>
            ))}
          </div>

          {visible.length === 0 ? (
            <p className="mt-3 text-xs leading-relaxed text-ink-muted">
              Nothing in this category yet.
            </p>
          ) : (
            <ul className="mt-3 grid max-h-[26rem] grid-cols-3 gap-2 overflow-y-auto pr-1">
              {visible.map((pick) => (
                <li key={pick.id}>
                  <button
                    type="button"
                    onClick={() => void addPiece(pick)}
                    title={pick.label}
                    className="w-full rounded border border-line bg-surface-sunk p-1 transition-colors hover:border-line-strong"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={pick.imageUrl}
                      alt={pick.label}
                      loading="lazy"
                      className="aspect-square w-full object-contain"
                    />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>

      <div className="order-1 lg:order-2">
        {banner ? (
          <p
            role="alert"
            className="mb-3 flex items-start gap-2 rounded-card border border-line bg-surface px-3.5 py-2.5 text-sm text-danger"
          >
            <AlertIcon className="mt-0.5 size-4 shrink-0" />
            {banner}
          </p>
        ) : null}

        <div
          ref={canvasRef}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onPointerDown={() => setSelectedId(null)}
          className="relative w-full overflow-hidden rounded-card border border-line bg-surface shadow-card"
          style={{ aspectRatio: CANVAS_ASPECT }}
        >
          {slots.length === 0 ? (
            <p className="absolute inset-0 flex items-center justify-center px-10 text-center text-sm text-ink-muted">
              Click a piece on the left to place it. Add a gap for anything the
              outfit needs but you don&apos;t own yet.
            </p>
          ) : null}

          {[...slots]
            .sort((a, b) => a.transform.z - b.transform.z)
            .map((slot) => {
              const isSelected = slot.id === selectedId;
              return (
                <div
                  key={slot.id}
                  className="absolute touch-none"
                  style={{
                    left: `${slot.transform.x * 100}%`,
                    top: `${slot.transform.y * 100}%`,
                    width: `${slot.transform.scale * 100}%`,
                    transform: `translate(-50%, -50%) rotate(${slot.transform.rotation}deg)`,
                  }}
                >
                  <div
                    onPointerDown={(event) => beginDrag(event, slot, "move")}
                    className={`cursor-grab active:cursor-grabbing ${
                      isSelected ? "outline outline-1 outline-offset-4 outline-line-strong" : ""
                    }`}
                  >
                    {slot.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={slot.imageUrl}
                        alt={slot.label}
                        className="w-full select-none"
                        draggable={false}
                      />
                    ) : (
                      <div className="flex aspect-square items-center justify-center rounded border border-dashed border-line-strong bg-surface-sunk/80 p-3 text-center">
                        <span className="text-xs leading-tight text-ink-muted">
                          {slot.label}
                        </span>
                      </div>
                    )}
                  </div>

                  {isSelected ? (
                    <>
                      <button
                        type="button"
                        aria-label="Resize"
                        onPointerDown={(event) => beginDrag(event, slot, "scale")}
                        className="absolute -bottom-2 -right-2 size-4 cursor-nwse-resize rounded-full border border-line-strong bg-surface shadow-card"
                      />
                      <button
                        type="button"
                        aria-label="Rotate"
                        onPointerDown={(event) => beginDrag(event, slot, "rotate")}
                        className="absolute -top-2 -right-2 flex size-4 cursor-grab items-center justify-center rounded-full border border-line-strong bg-surface shadow-card"
                      >
                        <RotateIcon className="size-2.5 text-ink-muted" />
                      </button>
                    </>
                  ) : null}
                </div>
              );
            })}
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-ink-muted">
            {slots.length === 0
              ? "Nothing placed yet"
              : `${slots.length} piece${slots.length === 1 ? "" : "s"}${
                  gapCount > 0 ? ` · ${gapCount} gap${gapCount === 1 ? "" : "s"}` : ""
                }`}
          </p>

          {selected ? (
            <div className="flex items-center gap-1.5">
              <span className="label mr-1 max-w-40 truncate">{selected.label}</span>
              <ToolbarButton onClick={() => restack(selected.id, -1)}>
                Send back
              </ToolbarButton>
              <ToolbarButton onClick={() => restack(selected.id, 1)}>
                Bring forward
              </ToolbarButton>
              <button
                type="button"
                onClick={() => void remove(selected.id)}
                title="Remove from this outfit"
                className="rounded-full p-1.5 text-ink-muted transition-colors hover:text-danger"
              >
                <TrashIcon className="size-3.5" label="Remove" />
              </button>
            </div>
          ) : (
            <p className="text-xs text-ink-muted">
              Drag to move · corner to resize · arrows to nudge · [ and ] to restack
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function FilterPill({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`rounded-full px-2 py-0.5 text-xs transition-colors ${
        active ? "bg-accent text-accent-ink" : "bg-surface-sunk text-ink-muted hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}

function ToolbarButton({
  onClick,
  children,
}: {
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-card border border-line px-2 py-1 text-xs text-ink-muted transition-colors hover:border-line-strong hover:text-ink"
    >
      {children}
    </button>
  );
}

/**
 * Describing something you don't own yet.
 *
 * This is the hinge the whole app turns on: a slot holding a `gap_spec` is a
 * shopping need, so filling this in is what turns an evening of composing
 * outfits into the list Phase 5 goes searching against. Category is the only
 * required field — "a black boot" is a useful want, and demanding material and
 * formality up front would make people skip it.
 */
function GapForm({
  onAdd,
  onCancel,
}: {
  onAdd: (gap: GapSpec) => void;
  onCancel: () => void;
}) {
  const [category, setCategory] = useState<Category>("top");
  const [color, setColor] = useState("");
  const [material, setMaterial] = useState("");
  const [formality, setFormality] = useState<number | null>(null);

  const field =
    "w-full rounded-sm border border-line bg-surface-sunk px-2 py-1 text-xs outline-none transition-colors placeholder:text-ink-muted focus:border-line-strong";

  return (
    <div className="mt-2.5 rounded border border-dashed border-line-strong bg-surface-sunk p-2.5">
      <div className="flex flex-wrap gap-1" role="group" aria-label="Gap category">
        {CATEGORIES.map((value) => (
          <FilterPill
            key={value}
            active={category === value}
            onClick={() => setCategory(value)}
          >
            {CATEGORY_LABELS[value]}
          </FilterPill>
        ))}
      </div>

      <div className="mt-2 flex gap-1.5">
        <input
          value={color}
          onChange={(event) => setColor(event.target.value)}
          placeholder="Colour"
          aria-label="Gap colour"
          className={field}
        />
        <input
          value={material}
          onChange={(event) => setMaterial(event.target.value)}
          placeholder="Material"
          aria-label="Gap material"
          className={field}
        />
      </div>

      <div className="mt-2 flex gap-1" role="group" aria-label="Gap formality">
        {[1, 2, 3, 4, 5].map((level) => (
          <button
            key={level}
            type="button"
            title={FORMALITY_LABELS[level]}
            aria-label={FORMALITY_LABELS[level]}
            aria-pressed={formality === level}
            onClick={() => setFormality(formality === level ? null : level)}
            className={`size-5 rounded-full text-[0.625rem] transition-colors ${
              formality === level
                ? "bg-accent text-accent-ink"
                : "bg-surface text-ink-muted hover:text-ink"
            }`}
          >
            {level}
          </button>
        ))}
      </div>

      <div className="mt-2.5 flex gap-1.5">
        <button
          type="button"
          onClick={() =>
            onAdd({
              category,
              color: color.trim() || null,
              material: material.trim() || null,
              formality,
            })
          }
          className="flex-1 rounded-card bg-accent px-3 py-1.5 text-xs font-medium text-accent-ink transition-opacity hover:opacity-90"
        >
          Add gap
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-card border border-line px-3 py-1.5 text-xs text-ink-muted transition-colors hover:text-ink"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
