import "server-only";

import { CATEGORIES, SEASONS, coerceTags, type GarmentTags } from "@/lib/garments";

/**
 * Auto-tagging a garment from its photo.
 *
 * A vision model fills in the fields no product page carries — colour, pattern,
 * formality, which seasons a piece belongs to — so the review grid starts from
 * a mostly-correct row rather than an empty form. Correcting is much faster
 * than typing, and getting through 300 items depends on that difference.
 *
 * The provider sits behind `GarmentTagger` for one reason: Google's free tier
 * reserves the right to train on what you send it, and these are photos of
 * someone's clothes. Swapping to a paid key, a different vendor, or a local
 * model should be one new implementation of this interface and nothing else.
 *
 * Tagging is best-effort by design. A tagger that is missing, rate-limited, or
 * confused must never block an import — the item still saves, flagged for
 * review, and the grid is where a human fixes it anyway.
 */

export type TagInput = {
  /** Base64 (no data: prefix) of a small JPEG — the cutout on white. */
  imageBase64: string;
  mimeType: string;
  /** Anything already known from a product page, e.g. "Uniqlo merino cardigan". */
  hint?: string | null;
};

export interface GarmentTagger {
  readonly name: string;
  tag(input: TagInput): Promise<GarmentTags>;
}

export class TaggingError extends Error {
  readonly status: number;
  constructor(message: string, status = 502) {
    super(message);
    this.name = "TaggingError";
    this.status = status;
  }
}

const PROMPT = `You are tagging one garment for a personal wardrobe catalogue.

The image shows a single item of clothing, usually cut out on a plain background
and sometimes still on a hanger. Describe the garment only — never the hanger,
the background, or anything worn with it.

- category: which wardrobe layer this belongs to.
- subcategory: the specific garment, two words at most ("oxford shirt", "chelsea boot").
- colors: one to three colour names as a person would say them ("charcoal", "cream", "olive"). Most saturated or dominant first.
- pattern: "solid", "striped", "checked", "floral", "printed" and so on.
- material: only if you can genuinely tell from the weave or sheen. Leave empty if unsure.
- formality: 1 lounge, 2 casual, 3 smart casual, 4 sharp, 5 formal.
- seasons: every season this piece would realistically be worn in.

Prefer leaving a field empty to guessing. A wrong tag costs more to find and fix
than a blank one costs to fill in.`;

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    category: { type: "string", enum: [...CATEGORIES] },
    subcategory: { type: "string" },
    colors: { type: "array", items: { type: "string" } },
    pattern: { type: "string" },
    material: { type: "string" },
    formality: { type: "integer" },
    seasons: { type: "array", items: { type: "string", enum: [...SEASONS] } },
  },
  required: ["category", "subcategory", "colors", "formality", "seasons"],
  propertyOrdering: [
    "category",
    "subcategory",
    "colors",
    "pattern",
    "material",
    "formality",
    "seasons",
  ],
} as const;

/**
 * Model id is configurable because Google renames and retires these faster than
 * anyone can keep a constant current, and which ones a given key may call for
 * free changes independently. A 404 from the API is almost always "that model
 * isn't available to this key" rather than a bug here, so it says so.
 */
const DEFAULT_MODEL = "gemini-3.6-flash";

class GeminiTagger implements GarmentTagger {
  readonly name = "gemini";

  constructor(
    private readonly apiKey: string,
    private readonly model: string,
  ) {}

  async tag({ imageBase64, mimeType, hint }: TagInput): Promise<GarmentTags> {
    const endpoint =
      `https://generativelanguage.googleapis.com/v1beta/models/` +
      `${encodeURIComponent(this.model)}:generateContent`;

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": this.apiKey,
      },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [
              { inlineData: { mimeType, data: imageBase64 } },
              {
                text: hint
                  ? `${PROMPT}\n\nThe retailer listing calls this: "${hint}". Trust the image over the listing where they disagree.`
                  : PROMPT,
              },
            ],
          },
        ],
        generationConfig: {
          temperature: 0,
          responseMimeType: "application/json",
          responseSchema: RESPONSE_SCHEMA,
        },
      }),
      // Tagging runs while the user watches a spinner; a slow call is a failed one.
      signal: AbortSignal.timeout(30_000),
    }).catch((error: unknown) => {
      if (error instanceof Error && error.name === "TimeoutError") {
        throw new TaggingError("The tagger took too long.", 504);
      }
      throw new TaggingError("Couldn't reach the tagger.", 502);
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      if (response.status === 404) {
        throw new TaggingError(
          `The model "${this.model}" isn't available to this API key. Set GEMINI_MODEL in .env.local to one that is.`,
          404,
        );
      }
      if (response.status === 429) {
        throw new TaggingError(
          "Daily free-tier quota for tagging is used up. Items still save; tag them by hand.",
          429,
        );
      }
      throw new TaggingError(
        `Tagger returned ${response.status}: ${detail.slice(0, 200)}`,
        502,
      );
    }

    const payload = (await response.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };

    const raw = payload.candidates?.[0]?.content?.parts
      ?.map((part) => part.text ?? "")
      .join("")
      .trim();

    if (!raw) throw new TaggingError("Tagger returned nothing usable.");

    try {
      // The response schema makes this JSON, but a truncated response is still
      // possible and shouldn't surface as an unhandled parse error.
      return coerceTags(JSON.parse(raw));
    } catch {
      throw new TaggingError("Tagger returned malformed JSON.");
    }
  }
}

/** Returns null when no provider is configured — a supported state, not an error. */
export function getTagger(): GarmentTagger | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  return new GeminiTagger(apiKey, process.env.GEMINI_MODEL || DEFAULT_MODEL);
}
