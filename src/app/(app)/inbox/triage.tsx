"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { LinkIcon, PlusIcon, SpinnerIcon, XIcon } from "@/components/icons";
import { captureUrl, dismissCapture, makeWant, restoreCapture } from "./actions";

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

  const submit = () => {
    if (!url.trim()) return;
    startTransition(async () => {
      setError(null);
      const result = await captureUrl(url);
      if (result.ok) setUrl("");
      else setError(result.error);
    });
  };

  return (
    <div className="rounded-card border border-line bg-surface p-4 shadow-card">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <LinkIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-faint" />
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
            className="w-full rounded-card border border-line bg-paper py-2 pl-9 pr-3 text-sm outline-none transition-colors focus:border-line-strong"
          />
        </div>
        <button
          type="button"
          disabled={pending || !url.trim()}
          onClick={submit}
          className="shrink-0 rounded-card bg-accent px-3.5 py-2 text-sm font-medium text-accent-ink transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {pending ? <SpinnerIcon className="size-4" /> : "Save"}
        </button>
      </div>
      {error ? <p className="mt-2 text-xs text-danger">{error}</p> : null}
      <p className="mt-2 text-xs text-ink-faint">
        The share sheet and the extension do this in one tap. This is the version
        that works anywhere.
      </p>
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

  const run = (work: () => Promise<{ ok: boolean; error?: string }>) =>
    startTransition(async () => {
      setError(null);
      const result = await work();
      if (!result.ok) setError(result.error ?? "That didn't work.");
    });

  if (dismissed) {
    return (
      <button
        type="button"
        disabled={pending}
        onClick={() => run(() => restoreCapture(captureId))}
        className="text-xs text-ink-muted underline underline-offset-4 transition-colors hover:text-ink disabled:opacity-50"
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
        className="flex flex-1 items-center justify-center gap-1.5 rounded-card bg-accent px-2.5 py-1.5 text-xs font-medium text-accent-ink transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        <PlusIcon className="size-3.5" />I want this
      </button>

      <button
        type="button"
        disabled={pending}
        onClick={() => run(() => dismissCapture(captureId))}
        className="rounded-card border border-line p-1.5 text-ink-muted transition-colors hover:border-line-strong hover:text-ink disabled:opacity-50"
        aria-label="Dismiss"
      >
        <XIcon className="size-3.5" />
      </button>

      {error ? <span className="text-xs text-danger">{error}</span> : null}
    </div>
  );
}
