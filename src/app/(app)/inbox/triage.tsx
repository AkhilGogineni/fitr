"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";

import {
  LinkIcon,
  PaperclipIcon,
  PlusIcon,
  SpinnerIcon,
  XIcon,
} from "@/components/icons";
import { btnPrimary } from "@/lib/ui";
import { uploadToR2 } from "@/lib/intake/upload";
import {
  attachCaptureImage,
  captureUrl,
  dismissCapture,
  makeWant,
  restoreCapture,
} from "./actions";

/**
 * The triage controls: paste a link, keep it, or throw it away.
 *
 * Utility register — this is a queue to be emptied, not a gallery. Two buttons
 * per capture and nothing else, because anything that needs a decision made
 * carefully is a capture that stays in the inbox, and an inbox that doesn't
 * reach empty stops being opened.
 */

export function PasteCapture() {
  const [url, setUrl] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // Not an error: "it saved, but the site refused us" is a success with a
  // caveat, and it reads differently on purpose.
  const [warning, setWarning] = useState<string | null>(null);

  const submit = () => {
    if (!url.trim()) return;
    startTransition(async () => {
      setError(null);
      setWarning(null);
      const result = await captureUrl(url);
      if (result.ok) {
        setUrl("");
        setWarning(result.warning ?? null);
      } else {
        setError(result.error);
      }
    });
  };

  return (
    <div className="rounded-card border border-line bg-surface p-4 shadow-card">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <LinkIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-copper" />
          <input
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                submit();
              }
            }}
            placeholder="Paste a link — TikTok, Instagram, a product page"
            className="w-full rounded-control border border-line bg-paper py-2 pl-9 pr-3 text-sm outline-none transition-colors placeholder:text-ink-faint focus:border-copper"
          />
        </div>
        <button
          type="button"
          disabled={pending || !url.trim()}
          onClick={submit}
          className={`${btnPrimary} shrink-0`}
        >
          {pending ? <SpinnerIcon className="size-4" /> : "Save"}
        </button>
      </div>
      {error ? <p className="mt-2 font-mono text-xs text-danger">{error}</p> : null}
      {warning ? (
        <p className="mt-2 font-mono text-xs leading-relaxed text-copper">{warning}</p>
      ) : null}
    </div>
  );
}

export function CaptureActions({
  captureId,
  dismissed,
}: {
  captureId: string;
  dismissed: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const run = (work: () => Promise<{ ok: boolean; error?: string }>) =>
    startTransition(async () => {
      setError(null);
      const result = await work();
      if (!result.ok) setError(result.error ?? "That didn't work.");
    });

  /*
   * The manual rescue for sites that block readers. The picture goes browser
   * → R2 on the same presigned path intake uses, then a server action wires
   * the key to the row — the bytes never route through this app's server.
   */
  const attach = (file: File) =>
    run(async () => {
      const upload = await uploadToR2(file, "capture").catch((uploadError: unknown) => ({
        ok: false as const,
        error:
          uploadError instanceof Error ? uploadError.message : "Upload failed.",
      }));
      if (!("key" in upload)) return { ok: false, error: upload.error };
      const result = await attachCaptureImage(captureId, upload.key);
      // The card's image renders server-side; the refresh is the update.
      if (result.ok) router.refresh();
      return result;
    });

  if (dismissed) {
    return (
      <button
        type="button"
        disabled={pending}
        onClick={() => run(() => restoreCapture(captureId))}
        className="w-full rounded-control border border-line py-1.5 text-xs text-ink-muted transition-colors hover:border-line-strong hover:text-ink disabled:opacity-50"
      >
        Put it back
      </button>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          run(async () => {
            const result = await makeWant(captureId);
            // Straight to the want, because the next thing you'd do is go
            // looking for it — and that's a button on the other page.
            if (result.ok) router.push(`/inbox/want/${result.data.id}`);
            return result;
          })
        }
        className={`${btnPrimary} flex-1 px-2.5 py-1.5 text-xs`}
      >
        <PlusIcon className="size-3.5" />I want this
      </button>

      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) attach(file);
        }}
      />
      <button
        type="button"
        disabled={pending}
        onClick={() => fileInput.current?.click()}
        aria-label="Attach a picture"
        title="Attach a picture — for sites that block readers"
        className="rounded-control border border-line p-1.5 text-ink-muted transition-colors hover:border-copper hover:text-copper disabled:opacity-50"
      >
        {pending ? <SpinnerIcon className="size-3.5" /> : <PaperclipIcon className="size-3.5" />}
      </button>

      <button
        type="button"
        disabled={pending}
        onClick={() => run(() => dismissCapture(captureId))}
        className="rounded-control border border-line p-1.5 text-ink-muted transition-colors hover:border-danger hover:text-danger disabled:opacity-50"
        aria-label="Dismiss"
      >
        <XIcon className="size-3.5" />
      </button>

      {error ? <span className="font-mono text-xs text-danger">{error}</span> : null}
    </div>
  );
}
