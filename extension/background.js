/*
 * The extension's one job: read the page you're on, and post it to fitr.
 *
 * Everything interesting happens in `reader.js`, which runs inside the tab.
 * This file is the plumbing — settings, the context menu, and one fetch.
 *
 * There is no content script declared in the manifest, deliberately. A content
 * script on every page you visit is a permission you shouldn't grant an
 * extension that only needs to act when you press its button. `activeTab` plus
 * `scripting.executeScript` gives access to exactly the tab you invoked it on,
 * at the moment you invoked it, and nothing else.
 */

import { readProductFromPage } from "./reader.js";

async function settings() {
  const stored = await chrome.storage.sync.get(["baseUrl", "token"]);
  return { baseUrl: (stored.baseUrl ?? "").replace(/\/$/, ""), token: stored.token ?? "" };
}

function notify(title, message) {
  chrome.notifications?.create({
    type: "basic",
    iconUrl: "icon-192.png",
    title,
    message,
  });
}

/**
 * Reads the tab and posts it.
 *
 * Returns a result rather than notifying, so the popup can show it inline and
 * the context menu can turn it into a notification. Two callers, one path.
 */
async function capture(tabId, extra = {}) {
  const { baseUrl, token } = await settings();
  if (!baseUrl || !token) {
    return { ok: false, error: "Set your fitr address and token in the extension's options." };
  }

  let page;
  try {
    // `func` serialises the function and runs it in the tab. The import above
    // exists so it can be written and read as ordinary code in its own file
    // rather than as a string — but it still executes over there, not here.
    const [injection] = await chrome.scripting.executeScript({
      target: { tabId },
      func: readProductFromPage,
    });
    page = injection?.result ?? null;
  } catch {
    return {
      ok: false,
      error:
        "Couldn't read this page. Chrome blocks extensions on its own pages and on the Web Store.",
    };
  }

  if (!page) return { ok: false, error: "Nothing readable on this page." };

  try {
    const response = await fetch(`${baseUrl}/api/capture`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ ...page, ...extra }),
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      return { ok: false, error: payload.error ?? `fitr answered ${response.status}.` };
    }
    return { ok: true, title: payload.title ?? page.title };
  } catch {
    return { ok: false, error: `Couldn't reach ${baseUrl}. Is the address right?` };
  }
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "fitr-save",
    title: "Save to fitr",
    contexts: ["page", "image", "link", "selection"],
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== "fitr-save" || !tab?.id) return;

  // A right-click on a specific image is a stronger signal than anything the
  // reader could infer, so it wins — the user pointed at the thing they meant.
  const extra = {};
  if (info.selectionText) extra.note = info.selectionText.slice(0, 500);
  if (info.linkUrl) extra.sourceUrl = info.linkUrl;

  const result = await capture(tab.id, extra);
  notify(
    result.ok ? "Saved to fitr" : "Couldn't save",
    result.ok ? (result.title ?? "It's in your inbox.") : result.error,
  );
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "capture") return false;
  capture(message.tabId, message.extra ?? {}).then(sendResponse);
  // Keeps the message channel open for the async reply. Without this the popup
  // gets `undefined` and looks like a silent failure.
  return true;
});
