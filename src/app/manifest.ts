import type { MetadataRoute } from "next";

/**
 * The web app manifest, which exists for exactly one reason: iOS refuses to
 * deliver a Web Push notification to a site in Safari. The page has to be
 * installed to the home screen first, and it can only be installed if it
 * declares a manifest with `display: standalone`.
 *
 * So this is not an attempt to make fitr feel like an app. It's the price of
 * the price-drop alert landing on a phone, and it's documented in
 * `docs/CAPTURE.md` alongside the one-time home-screen step it enables.
 *
 * `start_url` is the daily screen rather than the root, because someone who has
 * installed this to a home screen is opening it in the morning.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "fitr — wardrobe and what belongs in it next",
    short_name: "fitr",
    description:
      "Your wardrobe as cutouts, outfits on a canvas, and what to wear today.",
    start_url: "/today",
    display: "standalone",
    orientation: "portrait",
    // Matched to `--paper` and `--ink` in globals.css. The splash and the status
    // bar are the two surfaces the CSS tokens can't reach, so they're restated
    // here — and drift between them shows up as a flash of the wrong colour on
    // every cold launch.
    background_color: "#faf9f7",
    theme_color: "#faf9f7",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
