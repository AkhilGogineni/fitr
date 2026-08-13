/**
 * Cutting a garment out of its background, in the browser.
 *
 * RMBG-1.4 runs client-side through `@huggingface/transformers`: WebGPU where
 * the browser has it, WASM everywhere else. That makes the most expensive-
 * sounding requirement in this project free — no inference API, no per-image
 * cost — and the photos never leave the machine they were taken on.
 *
 * Why the long-hand `AutoModel` + `AutoProcessor` route instead of the
 * `background-removal` pipeline: RMBG-1.4's config declares
 * `SegformerForSemanticSegmentation`, which the pipeline's model registry
 * rejects outright ("Unsupported model type ... for task background-removal").
 * Loading the weights directly with `model_type: "custom"` sidesteps the
 * registry, and the processor config below is the one the model card specifies.
 * The pipeline API works with `Xenova/modnet`, but MODNet is a portrait matting
 * model — it is trained on people, and a cardigan on a hanger is not a person.
 *
 * RMBG-1.4's licence is non-commercial. Correct for a personal wardrobe; worth
 * revisiting before this is ever a product.
 *
 * Browser only — importing this from a Server Component will fail on `document`.
 */

import type { GarmentTags } from "@/lib/garments";

export type CutoutStage =
  | "loading-model"
  | "reading"
  | "cutting"
  | "encoding"
  | "done";

export type CutoutProgress = {
  stage: CutoutStage;
  /** 0–100 while model weights download; absent once inference starts. */
  percent?: number;
  detail?: string;
};

export type Cutout = {
  /** Transparent PNG of the garment. */
  cutout: Blob;
  /** The source image, downscaled — kept so a piece can be re-cut later. */
  original: Blob;
  /** Small JPEG on white, for the tagger. Composited because a transparent
   *  PNG flattens to black in most encoders, and black clothes on black tag
   *  badly. */
  forTagging: Blob;
  width: number;
  height: number;
};

/** Which backend actually loaded — surfaced in the UI, since WASM is ~10× slower. */
export type Backend = "webgpu" | "wasm";

const MODEL_ID = "briaai/RMBG-1.4";

/**
 * Originals are capped well above the cutout: enough detail to re-cut against a
 * better model later, small enough that a 300-item wardrobe stays inside R2's
 * free 10GB. Cutouts are capped at what the model works at internally, since
 * upscaling a 1024px mask back onto a 4000px photo buys nothing but bytes.
 */
const MAX_ORIGINAL_EDGE = 1600;
const MAX_CUTOUT_EDGE = 1024;
const TAGGING_EDGE = 512;

type Transformers = typeof import("@huggingface/transformers");

let loadPromise: Promise<{
  transformers: Transformers;
  model: Awaited<ReturnType<Transformers["AutoModel"]["from_pretrained"]>>;
  processor: Awaited<ReturnType<Transformers["AutoProcessor"]["from_pretrained"]>>;
  backend: Backend;
}> | null = null;

export function backendGuess(): Backend {
  return typeof navigator !== "undefined" && "gpu" in navigator ? "webgpu" : "wasm";
}

/**
 * Loads the model once per page load. ~44MB of weights, cached by the browser's
 * Cache API afterwards, so the second batch of photos starts instantly.
 */
async function load(onProgress?: (progress: CutoutProgress) => void) {
  if (!loadPromise) {
    loadPromise = (async () => {
      const transformers = await import("@huggingface/transformers");
      const { AutoModel, AutoProcessor, env } = transformers;

      // There is no local model directory to serve from; without this the
      // library requests /models/... from our own origin first and 404s.
      env.allowLocalModels = false;

      const report = (progress: { status: string; progress?: number; file?: string }) => {
        if (progress.status === "progress" && typeof progress.progress === "number") {
          onProgress?.({
            stage: "loading-model",
            percent: Math.round(progress.progress),
            detail: progress.file,
          });
        }
      };

      const backend = backendGuess();

      const model = await AutoModel.from_pretrained(MODEL_ID, {
        // Bypasses the model registry, which doesn't know this architecture.
        config: { model_type: "custom" } as never,
        // fp16 on this model produces visible speckle in the alpha channel; the
        // extra megabytes of fp32 are cheaper than hand-fixing 300 mattes.
        dtype: "fp32",
        device: backend,
        progress_callback: report,
      });

      const processor = await AutoProcessor.from_pretrained(MODEL_ID, {
        // RMBG-1.4 ships no preprocessor_config.json, so the model card's values
        // are supplied here. Changing `size` changes the mask's fidelity.
        config: {
          do_normalize: true,
          do_pad: false,
          do_rescale: true,
          do_resize: true,
          image_mean: [0.5, 0.5, 0.5],
          image_std: [1, 1, 1],
          feature_extractor_type: "ImageFeatureExtractor",
          resample: 2,
          rescale_factor: 0.00392156862745098,
          size: { width: 1024, height: 1024 },
        } as never,
        progress_callback: report,
      });

      return { transformers, model, processor, backend };
    })().catch((error: unknown) => {
      // Don't cache a failed load — a flaky first download should be retryable.
      loadPromise = null;
      throw error;
    });
  }

  return loadPromise;
}

/** Warms the model in the background so the first photo isn't the slow one. */
export function preloadCutter(onProgress?: (progress: CutoutProgress) => void) {
  return load(onProgress).then(({ backend }) => backend);
}

function scaleTo(width: number, height: number, maxEdge: number) {
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

async function drawToBlob(
  source: ImageBitmap | HTMLCanvasElement | OffscreenCanvas,
  width: number,
  height: number,
  type: string,
  quality?: number,
  background?: string,
): Promise<Blob> {
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas unavailable in this browser.");
  if (background) {
    context.fillStyle = background;
    context.fillRect(0, 0, width, height);
  }
  context.drawImage(source as CanvasImageSource, 0, 0, width, height);
  return canvas.convertToBlob({ type, quality });
}

/**
 * Runs one image through the cutter.
 *
 * Returns three renditions because each has a different consumer: the cutout is
 * what the wardrobe and the outfit canvas draw, the original is insurance
 * against a better model, and the tagging JPEG is what goes over the wire to a
 * vision API — smaller by an order of magnitude, which matters on a phone.
 */
export async function removeBackground(
  file: Blob,
  onProgress?: (progress: CutoutProgress) => void,
): Promise<Cutout> {
  const { transformers, model, processor } = await load(onProgress);
  const { RawImage } = transformers;

  onProgress?.({ stage: "reading" });

  // iPhones shoot HEIC by default and only Safari can decode it, so this is the
  // most likely first thing to go wrong for anyone photographing a wardrobe.
  // The browser's own message for it is "The source image could not be decoded".
  const bitmap = await createImageBitmap(file).catch(() => {
    throw new Error(
      "This browser can't read that image format. iPhone photos are HEIC by default — " +
        "set Camera → Formats to Most Compatible, or export as JPEG.",
    );
  });
  const originalSize = scaleTo(bitmap.width, bitmap.height, MAX_ORIGINAL_EDGE);
  const original = await drawToBlob(
    bitmap,
    originalSize.width,
    originalSize.height,
    "image/jpeg",
    0.9,
  );

  const cutSize = scaleTo(bitmap.width, bitmap.height, MAX_CUTOUT_EDGE);
  const scaledForCut = await drawToBlob(
    bitmap,
    cutSize.width,
    cutSize.height,
    "image/png",
  );
  bitmap.close();

  onProgress?.({ stage: "cutting" });

  const image = await RawImage.fromBlob(scaledForCut);
  const { pixel_values } = await processor(image);
  const { output } = await model({ input: pixel_values });

  // The model returns a single-channel matte in 0–1. Scaling it to 0–255 and
  // resizing back to the working size gives the alpha channel directly.
  const mask = await RawImage.fromTensor(output[0].mul(255).to("uint8")).resize(
    image.width,
    image.height,
  );

  const cut = image.clone().rgba();
  cut.putAlpha(mask);

  onProgress?.({ stage: "encoding" });

  const cutout = await cut.toBlob("image/png");

  // Composite on white for the tagger: colours read true, and no encoder has to
  // decide what to do with an alpha channel it will only throw away.
  const cutoutBitmap = await createImageBitmap(cutout);
  const tagSize = scaleTo(cut.width, cut.height, TAGGING_EDGE);
  const forTagging = await drawToBlob(
    cutoutBitmap,
    tagSize.width,
    tagSize.height,
    "image/jpeg",
    0.85,
    "#ffffff",
  );
  cutoutBitmap.close();

  onProgress?.({ stage: "done" });

  return {
    cutout,
    original,
    forTagging,
    width: cut.width,
    height: cut.height,
  };
}

/** Sends the tagging rendition to our server, which holds the API key. */
export async function requestTags(
  forTagging: Blob,
  hint?: string | null,
): Promise<{ tags: GarmentTags } | { error: string }> {
  const base64 = await blobToBase64(forTagging);

  const response = await fetch("/api/tag", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ imageBase64: base64, mimeType: forTagging.type, hint }),
  });

  const payload = (await response.json().catch(() => ({}))) as {
    tags?: GarmentTags;
    error?: string;
  };

  if (!response.ok || !payload.tags) {
    return { error: payload.error ?? "Tagging is unavailable." };
  }
  return { tags: payload.tags };
}

export async function blobToBase64(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  // Chunked so a multi-megabyte image doesn't blow the argument limit on
  // String.fromCharCode.
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}
