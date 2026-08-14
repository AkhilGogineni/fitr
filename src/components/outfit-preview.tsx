import { CATEGORY_LABELS } from "@/lib/garments";
import { CANVAS_ASPECT, describeGap, type SlotView } from "@/lib/outfits";

/**
 * Draws an outfit, read-only.
 *
 * One renderer for three places: the thumbnail on the outfits list, the phone
 * view, and (from Phase 3) the daily suggestion. Because every slot's placement
 * is stored in fractions of the canvas rather than pixels, the same numbers
 * produce the same composition at 180px and at 900px — so these can never drift
 * apart the way two separate renderers would.
 *
 * No "use client": this is pure output, so it stays a Server Component and ships
 * no JavaScript.
 */
export function OutfitPreview({
  slots,
  className = "",
}: {
  slots: SlotView[];
  className?: string;
}) {
  return (
    <div
      className={`relative w-full overflow-hidden rounded bg-surface-sunk ${className}`}
      style={{ aspectRatio: CANVAS_ASPECT }}
    >
      {[...slots]
        .sort((a, b) => a.transform.z - b.transform.z)
        .map((slot) => (
          <div
            key={slot.id}
            className="absolute"
            style={{
              left: `${slot.transform.x * 100}%`,
              top: `${slot.transform.y * 100}%`,
              width: `${slot.transform.scale * 100}%`,
              transform: `translate(-50%, -50%) rotate(${slot.transform.rotation}deg)`,
            }}
          >
            {slot.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={slot.imageUrl}
                alt={slot.label}
                loading="lazy"
                className="w-full select-none"
                draggable={false}
              />
            ) : (
              <div className="flex aspect-square items-center justify-center rounded border border-dashed border-line-strong bg-surface/60 p-2 text-center">
                <span className="text-[0.5rem] leading-tight text-ink-muted">
                  {slot.gap_spec
                    ? describeGap(slot.gap_spec, CATEGORY_LABELS[slot.layer])
                    : CATEGORY_LABELS[slot.layer]}
                </span>
              </div>
            )}
          </div>
        ))}
    </div>
  );
}
