import "server-only";

import webpush from "web-push";

import { vapidKeys } from "@/lib/env";

/**
 * Sending a Web Push notification.
 *
 * Push is opt-in and entirely optional — the price watch writes its
 * observations, flags its drops, and shows them on `/watch` whether or not a
 * single subscription exists. So every function here treats "not configured"
 * as an ordinary state and returns rather than throwing. A missing VAPID key
 * must never fail a cron run whose real job is recording prices.
 *
 * `web-push` rather than hand-rolled: the payload has to be encrypted to the
 * subscription's ECDH key with HKDF and AES-GCM, and the request signed as a
 * VAPID JWT. That is a lot of cryptography to get subtly wrong for a feature
 * that sends one notification a week.
 */

export type PushSubscriptionRow = {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
};

export type PushPayload = {
  title: string;
  body: string;
  /** Where clicking it should land. */
  url?: string;
  /** Notifications sharing a tag replace each other instead of stacking. */
  tag?: string;
};

let configured = false;

function configure(): boolean {
  const keys = vapidKeys();
  if (!keys) return false;
  if (!configured) {
    webpush.setVapidDetails(keys.subject, keys.publicKey, keys.privateKey);
    configured = true;
  }
  return true;
}

export function pushIsConfigured() {
  return vapidKeys() !== null;
}

/**
 * The outcome of one send, for the caller to act on.
 *
 * `gone` is the one that matters: push services answer 404 or 410 for a
 * subscription that no longer exists — the browser was reinstalled, the PWA was
 * deleted from the home screen, permission was revoked. Those rows should be
 * deleted, not retried forever, so the distinction is surfaced rather than
 * flattened into "failed".
 */
export type SendResult = { ok: true } | { ok: false; gone: boolean; error: string };

export async function sendPush(
  subscription: PushSubscriptionRow,
  payload: PushPayload,
): Promise<SendResult> {
  if (!configure()) {
    return { ok: false, gone: false, error: "Push isn't configured." };
  }

  try {
    await webpush.sendNotification(
      {
        endpoint: subscription.endpoint,
        keys: { p256dh: subscription.p256dh, auth: subscription.auth },
      },
      JSON.stringify(payload),
      // A drop is worth a day of retries and no more; after that the next cron
      // run will notice the same drop anyway.
      { TTL: 86_400, urgency: "normal" },
    );
    return { ok: true };
  } catch (error) {
    const status =
      typeof error === "object" && error !== null && "statusCode" in error
        ? Number((error as { statusCode: unknown }).statusCode)
        : 0;
    return {
      ok: false,
      gone: status === 404 || status === 410,
      error: error instanceof Error ? error.message : "Push failed.",
    };
  }
}
