import "server-only";

import { CATEGORY_LABELS, type Category } from "@/lib/garments";
import type { Occasion } from "@/lib/outfits";
import { stylingBrief } from "@/lib/styling/rulebook";
import type { ScoredOutfit } from "@/lib/styling/score";
import type { Forecast } from "@/lib/weather";

/**
 * Choosing one outfit from the shortlist, and saying why.
 *
 * The rules engine has already decided what is wearable. This decides which of
 * the wearable options is the good one — the judgement call that a scoring
 * function is genuinely bad at, because ranking ten defensible outfits is a
 * matter of taste and taste doesn't reduce to a weighted sum.
 *
 * Three things keep this honest:
 *
 * **The model chooses, it doesn't compose.** It gets an index into a list the
 * engine built, so it cannot invent a garment, pair a coat with shorts, or
 * suggest something in the wash. The worst outcome of a bad model day is the
 * second-best wearable outfit rather than a nonsense one.
 *
 * **It gets the same rulebook the scorer used**, rendered as prose. So the
 * sentence it writes is grounded in the rules that produced the shortlist,
 * rather than in whatever styling advice it absorbed in training.
 *
 * **Failure is silent and total.** No key, no quota, a timeout, a malformed
 * response, an index that doesn't exist — every one of them falls back to the
 * engine's own top pick with a reason assembled from the rules that fired. The
 * daily screen is the one that has to work every morning, and it must never
 * depend on a free tier being in a good mood.
 */

const DEFAULT_MODEL = "gemini-3.6-flash";

export type Pick = {
  outfit: ScoredOutfit;
  reason: string;
  pickedBy: "gemini" | "rules";
};

/** One line per garment, dense enough for the model and cheap in tokens. */
function describeItem(item: ScoredOutfit["items"][number]) {
  return [
    CATEGORY_LABELS[item.category as Category] ?? item.category,
    item.subcategory,
    item.colors.length > 0 ? item.colors.join("/") : null,
    item.material,
    item.pattern && item.pattern.toLowerCase() !== "solid" ? item.pattern : null,
    item.brand,
    typeof item.formality === "number" ? `formality ${item.formality}` : null,
  ]
    .filter(Boolean)
    .join(", ");
}

function describeCandidate(candidate: ScoredOutfit, index: number) {
  const lines = candidate.items.map((item) => `    - ${describeItem(item)}`).join("\n");
  const notes = [
    candidate.praise.length > 0 ? `rules liked: ${candidate.praise.join(" ")}` : null,
    candidate.gripes.length > 0 ? `rules flagged: ${candidate.gripes.join(" ")}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return `  [${index}] score ${candidate.score}${candidate.outfitId ? " (a saved outfit)" : ""}\n${lines}${notes ? `\n    ${notes}` : ""}`;
}

/**
 * The fallback sentence, built from the rules that actually fired.
 *
 * Not a generic apology: if the engine's reasons were good enough to rank the
 * outfit first, they're good enough to explain it. This is what the screen
 * shows on any day the model isn't reachable, and it should read as a
 * deliberate answer rather than a degraded one.
 */
export function rulesReason(
  candidate: ScoredOutfit,
  forecast: Forecast | null,
): string {
  const parts = candidate.praise.slice(0, 2);
  if (forecast) parts.push(`It's ${forecast.summary} today.`);
  if (parts.length === 0) return "The best fit for today from what's clean and in season.";
  return parts.join(" ");
}

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    choice: { type: "integer" },
    reason: { type: "string" },
  },
  required: ["choice", "reason"],
  propertyOrdering: ["choice", "reason"],
} as const;

export async function pickOutfit(
  candidates: ScoredOutfit[],
  {
    occasion,
    forecast,
  }: { occasion: Occasion; forecast: Forecast | null },
): Promise<Pick> {
  if (candidates.length === 0) {
    throw new Error("pickOutfit needs at least one candidate.");
  }

  const best = candidates[0];
  const fallback: Pick = {
    outfit: best,
    reason: rulesReason(best, forecast),
    pickedBy: "rules",
  };

  const apiKey = process.env.GEMINI_API_KEY;
  // One candidate is not a choice, so there's nothing to spend a call on.
  if (!apiKey || candidates.length === 1) return fallback;

  const model = process.env.GEMINI_MODEL || DEFAULT_MODEL;
  const endpoint =
    `https://generativelanguage.googleapis.com/v1beta/models/` +
    `${encodeURIComponent(model)}:generateContent`;

  const weatherLine = forecast
    ? `Today: ${forecast.summary}. Feels like ${forecast.feelsLikeMin}–${forecast.feelsLikeMax}°C, ${forecast.precipChance}% chance of rain, wind to ${forecast.windMax} km/h.`
    : "No forecast available today — don't mention the weather.";

  const prompt = `${stylingBrief()}

${weatherLine}
The occasion is: ${occasion.replace("_", " ")}.

Here are the outfits that are actually wearable today, all built from clothes
this person owns. A rules engine scored them; the score is a starting point and
not a verdict — it is good at ruling things out and mediocre at picking a
favourite, which is what you are for.

${candidates.map(describeCandidate).join("\n\n")}

Pick one by its index. Prefer the one that reads best as an outfit, not the one
with the highest number. A saved outfit was composed by hand and deserves the
benefit of the doubt.

Then write ONE sentence, at most 20 words, saying why this is the right thing to
wear today. Address the person directly. Name specific garments. Mention the
weather only if it genuinely drove the choice. Do not use the words "outfit",
"stylish", "elevate", "effortless", or "perfect". Do not flatter. Write the way
you'd say it out loud to someone standing in front of their wardrobe.`;

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          // Not zero: this is a taste call, and a deterministic one would
          // suggest the same thing every Tuesday with the same forecast.
          temperature: 0.7,
          responseMimeType: "application/json",
          responseSchema: RESPONSE_SCHEMA,
        },
      }),
      // Shorter than the tagger's budget. This runs while someone is standing
      // in front of their wardrobe on a weekday morning; slow is the same as
      // broken, and the fallback is genuinely good.
      signal: AbortSignal.timeout(12_000),
    });

    if (!response.ok) return fallback;

    const payload = (await response.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    const raw = payload.candidates?.[0]?.content?.parts
      ?.map((part) => part.text ?? "")
      .join("")
      .trim();
    if (!raw) return fallback;

    const parsed = JSON.parse(raw) as { choice?: unknown; reason?: unknown };
    const choice = Number(parsed.choice);
    // An index outside the list means the model invented an option. Falling
    // back is right: the alternative is showing clothes that weren't offered.
    if (!Number.isInteger(choice) || choice < 0 || choice >= candidates.length) {
      return fallback;
    }

    const reason =
      typeof parsed.reason === "string" && parsed.reason.trim()
        ? parsed.reason.trim().slice(0, 240)
        : rulesReason(candidates[choice], forecast);

    return { outfit: candidates[choice], reason, pickedBy: "gemini" };
  } catch {
    // Timeout, network, malformed JSON — all the same answer. This path is not
    // logged as an error because it is an expected state, not a fault.
    return fallback;
  }
}
