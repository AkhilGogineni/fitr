"use client";

import { useState } from "react";
import { MannequinSVG, type MannequinView } from "./mannequin-svg";
import type { Category } from "@/lib/garments";
import { publicUrlFor } from "@/lib/r2";

type GarmentPlacement = {
  category: Category;
  frontKey: string;
  backKey?: string | null;
  zIndex: number;
};

const BODY_ZONES: Record<
  Category,
  { top: number; height: number; anchorScale: number }
> = {
  top: { top: 0.12, height: 0.35, anchorScale: 0.7 },
  bottom: { top: 0.42, height: 0.32, anchorScale: 0.55 },
  outerwear: { top: 0.10, height: 0.45, anchorScale: 0.85 },
  shoes: { top: 0.82, height: 0.16, anchorScale: 0.4 },
  socks: { top: 0.72, height: 0.14, anchorScale: 0.3 },
  accessory: { top: 0.08, height: 0.12, anchorScale: 0.25 },
};

const Z_INDEX_ORDER: Record<Category, number> = {
  outerwear: 5,
  top: 4,
  bottom: 3,
  shoes: 2,
  socks: 1,
  accessory: 0,
};

export function MannequinView({
  garments,
  interactive = true,
  className = "",
}: {
  garments: GarmentPlacement[];
  interactive?: boolean;
  className?: string;
}) {
  const [view, setView] = useState<MannequinView>("front");
  const [isFlipping, setIsFlipping] = useState(false);

  const hasBackView = garments.some((g) => g.backKey);

  const handleFlip = () => {
    if (!interactive || (!hasBackView && view === "front")) return;
    setIsFlipping(true);
    setView((v) => (v === "front" ? "back" : "front"));
    setTimeout(() => setIsFlipping(false), 600);
  };

  const sortedGarments = [...garments].sort(
    (a, b) => (Z_INDEX_ORDER[a.category] ?? 0) - (Z_INDEX_ORDER[b.category] ?? 0)
  );

  return (
    <div
      className={`relative ${className}`}
      style={{ perspective: "800px", perspectiveOrigin: "50% 40%" }}
    >
      <button
        type="button"
        onClick={handleFlip}
        disabled={!interactive || (!hasBackView && view === "front")}
        className={`relative w-full h-full ${interactive ? "cursor-pointer" : "cursor-default"}`}
        style={{
          transformStyle: "preserve-3d",
          transition: "transform 0.6s cubic-bezier(0.34, 1.56, 0.64, 1)",
          transform: view === "back" ? "rotateY(180deg)" : "rotateY(0deg)",
        }}
        aria-label={view === "front" ? "View back" : "View front"}
      >
        {/* Front face */}
        <div
          className="absolute inset-0"
          style={{ backfaceVisibility: "hidden" }}
        >
          <MannequinSVG view="front" className="w-full h-full" />
          {view === "front" &&
            sortedGarments.map((garment) => (
              <GarmentLayer
                key={garment.category}
                garment={garment}
                side="front"
              />
            ))}
        </div>

        {/* Back face */}
        <div
          className="absolute inset-0"
          style={{
            backfaceVisibility: "hidden",
            transform: "rotateY(180deg)",
          }}
        >
          <MannequinSVG view="back" className="w-full h-full" />
          {view === "back" &&
            sortedGarments.map((garment) => (
              <GarmentLayer
                key={garment.category}
                garment={garment}
                side="back"
              />
            ))}
        </div>
      </button>

      {/* Flip hint */}
      {interactive && hasBackView && !isFlipping && (
        <div className="absolute bottom-2 left-1/2 -translate-x-1/2 text-xs opacity-40 pointer-events-none">
          {view === "front" ? "tap to flip" : "tap to flip back"}
        </div>
      )}
    </div>
  );
}

function GarmentLayer({
  garment,
  side,
}: {
  garment: GarmentPlacement;
  side: "front" | "back";
}) {
  const zone = BODY_ZONES[garment.category];
  const key = side === "back" ? garment.backKey : garment.frontKey;

  if (!key) return null;

  return (
    <img
      src={publicUrlFor(key)}
      alt=""
      className="absolute left-1/2 -translate-x-1/2 object-contain pointer-events-none"
      style={{
        top: `${zone.top * 100}%`,
        height: `${zone.height * 100}%`,
        width: `${zone.anchorScale * 100}%`,
        zIndex: garment.zIndex,
      }}
      loading="lazy"
    />
  );
}