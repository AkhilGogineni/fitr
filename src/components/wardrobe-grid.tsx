"use client";

import { useState } from "react";
import { MannequinView } from "./mannequin-view";
import type { Category } from "@/lib/garments";
import { CATEGORY_LABELS, formatPrice } from "@/lib/garments";
import { publicUrlFor } from "@/lib/r2";

type WardrobeItem = {
  id: string;
  category: string;
  subcategory: string | null;
  brand: string | null;
  colors: string[];
  image_cutout_key: string;
  image_cutout_back_key: string | null;
  purchase_price_cents: number | null;
  needs_review: boolean;
};

type ViewMode = "grid" | "mannequin";

export function WardrobeGrid({
  items,
  className = "",
}: {
  items: WardrobeItem[];
  className?: string;
}) {
  const [viewMode, setViewMode] = useState<ViewMode>("grid");

  return (
    <div className={className}>
      {/* View toggle */}
      <div className="mb-4 flex gap-2">
        <button
          type="button"
          onClick={() => setViewMode("grid")}
          className={`rounded-full px-3 py-1 text-sm transition-colors ${
            viewMode === "grid"
              ? "bg-ink text-[var(--paper)]"
              : "bg-surface-sunk text-ink-muted hover:text-ink"
          }`}
        >
          Grid
        </button>
        <button
          type="button"
          onClick={() => setViewMode("mannequin")}
          className={`rounded-full px-3 py-1 text-sm transition-colors ${
            viewMode === "mannequin"
              ? "bg-ink text-[var(--paper)]"
              : "bg-surface-sunk text-ink-muted hover:text-ink"
          }`}
        >
          Mannequin
        </button>
      </div>

      {/* Grid view */}
      {viewMode === "grid" && (
        <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {items.map((item, index) => (
            <li
              key={item.id}
              className="group animate-rise rounded-card border border-line bg-surface p-3 shadow-card transition-[box-shadow,border-color] duration-200 hover:-translate-y-0.5 hover:border-line-strong hover:shadow-lift"
              style={{ animationDelay: `${Math.min(index * 40, 400)}ms` }}
            >
              <div className="relative aspect-square overflow-hidden rounded bg-surface-sunk">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={publicUrlFor(item.image_cutout_key)}
                  alt={
                    item.subcategory ??
                    CATEGORY_LABELS[item.category as Category]
                  }
                  loading="lazy"
                  className="size-full object-contain p-2 transition-transform duration-500 group-hover:scale-[1.03]"
                />
                {item.needs_review ? (
                  <span className="absolute left-2 top-2 rounded-full bg-copper px-2 py-0.5 font-mono text-[0.625rem] uppercase tracking-wide text-[#f5efdf]">
                    Needs a look
                  </span>
                ) : null}
              </div>

              <p className="mt-2.5 truncate text-sm">
                {item.brand ??
                  item.subcategory ??
                  CATEGORY_LABELS[item.category as Category]}
              </p>
              <p className="label nums mt-0.5 truncate">
                {item.subcategory && item.brand
                  ? item.subcategory
                  : CATEGORY_LABELS[item.category as Category]}
                {item.purchase_price_cents
                  ? ` · ${formatPrice(item.purchase_price_cents, null)}`
                  : ""}
              </p>
            </li>
          ))}
        </ul>
      )}

      {/* Mannequin view */}
      {viewMode === "mannequin" && (
        <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {items.map((item, index) => (
            <li
              key={item.id}
              className="group animate-rise rounded-card border border-line bg-surface p-3 shadow-card transition-[box-shadow,border-color] duration-200 hover:-translate-y-0.5 hover:border-line-strong hover:shadow-lift"
              style={{ animationDelay: `${Math.min(index * 40, 400)}ms` }}
            >
              <div className="relative aspect-square overflow-hidden rounded bg-surface-sunk">
                <MannequinView
                  garments={[
                    {
                      category: item.category as Category,
                      frontKey: item.image_cutout_key,
                      backKey: item.image_cutout_back_key,
                      zIndex: 0,
                    },
                  ]}
                  interactive={false}
                  className="size-full"
                />
                {item.needs_review ? (
                  <span className="absolute left-2 top-2 rounded-full bg-copper px-2 py-0.5 font-mono text-[0.625rem] uppercase tracking-wide text-[#f5efdf]">
                    Needs a look
                  </span>
                ) : null}
              </div>

              <p className="mt-2.5 truncate text-sm">
                {item.brand ??
                  item.subcategory ??
                  CATEGORY_LABELS[item.category as Category]}
              </p>
              <p className="label nums mt-0.5 truncate">
                {item.subcategory && item.brand
                  ? item.subcategory
                  : CATEGORY_LABELS[item.category as Category]}
                {item.purchase_price_cents
                  ? ` · ${formatPrice(item.purchase_price_cents, null)}`
                  : ""}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}