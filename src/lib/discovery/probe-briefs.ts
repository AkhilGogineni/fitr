import type { Candidate, SearchBrief } from "@/lib/discovery/search";

/**
 * The fixed briefs `npm run discovery:probe` measures discovery against, and
 * the rule it scores them by — shared by the local probe and the remote one
 * (`src/app/api/dev/discovery-probe`), so both score identically.
 *
 * Type-only imports: this file must load in a plain Node script without
 * pulling in `search.ts` (which is `server-only`).
 */

/** US shopper, US prices. Ceilings in cents, as `profiles.price_ceilings` stores them. */
export const BRIEFS: SearchBrief[] = [
  {
    title: "Oversized cream cable-knit sweater",
    description: "chunky wool, crew neck",
    category: "top",
    ceilingCents: 12_000,
    familiarBrands: [],
  },
  {
    title: "Heavyweight plain white t-shirt",
    description: "boxy fit, thick cotton, no logo",
    category: "top",
    ceilingCents: 5_000,
    familiarBrands: ["uniqlo"],
  },
  {
    title: "Navy oxford cloth button-down shirt",
    description: "slim but not skinny, real button-down collar",
    category: "top",
    ceilingCents: 9_000,
    familiarBrands: [],
  },
  {
    title: "Straight-leg raw selvedge denim jeans",
    description: "dark indigo, mid rise",
    category: "bottom",
    ceilingCents: 20_000,
    familiarBrands: ["levi's"],
  },
  {
    title: "Olive pleated wide-leg chinos",
    description: "cotton twill, relaxed through the thigh",
    category: "bottom",
    ceilingCents: 11_000,
    familiarBrands: [],
  },
  {
    title: "White leather low-top sneakers",
    description: "minimal, no big branding",
    category: "shoes",
    ceilingCents: 15_000,
    familiarBrands: ["nike", "adidas"],
  },
  {
    title: "Brown suede chelsea boots",
    description: "pull-on, elastic side panels",
    category: "shoes",
    ceilingCents: 25_000,
    familiarBrands: [],
  },
  {
    title: "Waxed cotton field jacket",
    description: "olive or tan, corduroy collar",
    category: "outerwear",
    ceilingCents: 30_000,
    familiarBrands: [],
  },
  {
    title: "Black lightweight packable down jacket",
    description: "for layering, no hood",
    category: "outerwear",
    ceilingCents: 18_000,
    familiarBrands: ["patagonia"],
  },
  {
    title: "Merino wool beanie",
    description: "charcoal, ribbed, cuffed",
    category: "accessory",
    ceilingCents: 4_000,
    familiarBrands: [],
  },
];

/**
 * A kept result that a shopper could act on — "a plausible, in-stock, buyable
 * piece": a page that described itself as one product, with a price stated in
 * US dollars at or under the brief's ceiling, whose offers say in stock, and
 * whose own product name names the garment the brief asked for. Every clause
 * must be read off the page; "didn't say" never counts. A brief "scores" when
 * it yields at least one.
 */
export const scores = (brief: SearchBrief, c: Candidate): boolean =>
  c.pageKind === "product" &&
  c.priceCents !== null &&
  c.currency === "USD" &&
  (!brief.ceilingCents || c.priceCents <= brief.ceilingCents) &&
  c.availability === "in_stock" &&
  c.relevance === "match";
