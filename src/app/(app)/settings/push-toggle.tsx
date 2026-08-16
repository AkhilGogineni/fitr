"use client";

import { useEffect, useState } from "react";

import { BellIcon, CheckIcon } from "@/components/icons";

/**
 * Turning price-drop notifications on, and being honest about what that takes.
 *
 * Web Push has more ways to be unavailable than any other browser API this app
 * touches, and each one has a different remedy: an unconfigured server, a
 * browser without the API, iOS Safari refusing until the page is installed to
 * the home screen, a permission already denied and now only changeable in
 * settings. Collapsing those into one greyed-out button is how a feature
 * quietly stops existing — so each state says which one it is.
 *
 * None of this is load-bearing. The price watch records every observation and
 * flags every drop on `/watch` whether or not this is ever switched on.
 */

type State =
  | "checking"
  | "unsupported"
  | "needs-install"
  | "unconfigured"
  | "denied"
  | "off"
  | "on";

/** A VAPID key travels as base64url and the Push API wants raw bytes. */
function urlBase64ToUint8Array(base64: string) {
  const padded = (base64 + "=".repeat((4 - (base64.length % 4)) % 4))
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  const raw = atob(padded);
  return Uint8Array.from(raw, (character) => character.charCodeAt(0));
}

export function PushToggle({ vapidPublicKey }: { vapidPublicKey: string | null }) {
  const [state, setState] = useState<State>("checking");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Works out which of the six states this browser is in.
   *
   * Deliberately async even for the parts that are knowable synchronously.
   * Detection can't run during render — `navigator` and `Notification` don't
   * exist while this is prerendered on the server — and setting state
   * synchronously inside an effect cascades a second render. Resolving it all
   * through one promise gives one state write, after mount, on every path.
   */
  useEffect(() => {
    let cancelled = false;

    const detect = async (): Promise<State> => {
      if (!vapidPublicKey) return "unconfigured";
      if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
        // On iOS the Push API is genuinely absent in Safari and appears only
        // once the page runs from the home screen, so which fix to suggest
        // depends on which platform is missing it.
        return /iphone|ipad|ipod/i.test(navigator.userAgent ?? "")
          ? "needs-install"
          : "unsupported";
      }
      if (Notification.permission === "denied") return "denied";

      const registration = await navigator.serviceWorker.getRegistration();
      const subscription = await registration?.pushManager.getSubscription();
      return subscription ? "on" : "off";
    };

    detect()
      .then((next) => {
        if (!cancelled) setState(next);
      })
      .catch(() => {
        if (!cancelled) setState("off");
      });

    return () => {
      cancelled = true;
    };
  }, [vapidPublicKey]);

  async function enable() {
    if (!vapidPublicKey) return;
    setBusy(true);
    setError(null);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState(permission === "denied" ? "denied" : "off");
        return;
      }

      const registration = await navigator.serviceWorker.register("/sw.js");
      // `ready` rather than the register() result: a worker that hasn't
      // activated yet cannot be subscribed, and register() resolves before it.
      await navigator.serviceWorker.ready;

      const subscription = await registration.pushManager.subscribe({
        // Required to be true by every browser — a silent push isn't allowed.
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
      });

      const response = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(subscription.toJSON()),
      });
      if (!response.ok) throw new Error((await response.json()).error ?? "Failed to save.");

      setState("on");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn't turn that on.");
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    setError(null);
    try {
      const registration = await navigator.serviceWorker.getRegistration();
      const subscription = await registration?.pushManager.getSubscription();
      if (subscription) {
        await fetch("/api/push/subscribe", {
          method: "DELETE",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ endpoint: subscription.endpoint }),
        });
        await subscription.unsubscribe();
      }
      setState("off");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn't turn that off.");
    } finally {
      setBusy(false);
    }
  }

  const explanation: Record<State, string> = {
    checking: "Checking…",
    unsupported: "This browser doesn't do web push. The watch page still shows every drop.",
    "needs-install":
      "On iPhone, notifications only work once fitr is added to the home screen: Share → Add to Home Screen, then open it from there and come back here.",
    unconfigured:
      "Not set up on the server — VAPID keys are missing. Drops still land on the watch page. See SETUP.md.",
    denied:
      "Notifications are blocked for this site. You'd need to allow them in the browser's own settings.",
    off: "Get a notification when something you're watching drops below what you'd pay.",
    on: "You'll get a notification when a watched piece drops.",
  };

  return (
    <section className="rounded-card border border-line bg-surface p-5 shadow-card">
      <h2 className="flex items-center gap-2 text-sm font-medium">
        <BellIcon className="size-4" />
        Price alerts
      </h2>
      <p className="mt-1 text-sm text-ink-muted">{explanation[state]}</p>

      {state === "off" ? (
        <button
          type="button"
          disabled={busy}
          onClick={enable}
          className="mt-4 rounded-card bg-accent px-3.5 py-2 text-sm font-medium text-accent-ink transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {busy ? "Enabling…" : "Enable notifications"}
        </button>
      ) : null}

      {state === "on" ? (
        <div className="mt-4 flex items-center gap-3">
          <span className="flex items-center gap-1.5 text-xs text-ink-muted">
            <CheckIcon className="size-3.5" /> On for this device
          </span>
          <button
            type="button"
            disabled={busy}
            onClick={disable}
            className="text-xs text-ink-muted underline underline-offset-4 transition-colors hover:text-ink disabled:opacity-50"
          >
            Turn off
          </button>
        </div>
      ) : null}

      {error ? <p className="mt-2 text-xs text-danger">{error}</p> : null}
    </section>
  );
}
