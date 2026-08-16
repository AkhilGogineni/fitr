/*
 * The popup. Shows what page you're on, takes an optional note, saves.
 *
 * All the work is delegated to the background worker so the popup can close
 * immediately without cancelling an in-flight request — a popup closes the
 * moment focus leaves it, and anything awaiting a fetch in here dies with it.
 */

const pageLine = document.getElementById("page");
const noteField = document.getElementById("note");
const saveButton = document.getElementById("save");
const status = document.getElementById("status");

document.getElementById("options").addEventListener("click", (event) => {
  event.preventDefault();
  chrome.runtime.openOptionsPage();
});

const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

if (!tab?.id || !/^https?:/.test(tab.url ?? "")) {
  pageLine.textContent = "Nothing to save on this page.";
  saveButton.disabled = true;
} else {
  pageLine.textContent = tab.title ?? tab.url;
  pageLine.title = tab.url ?? "";
}

// Configured or not, said up front rather than after a failed save.
const { baseUrl, token } = await chrome.storage.sync.get(["baseUrl", "token"]);
if (!baseUrl || !token) {
  status.textContent = "Set your fitr address and token in Settings first.";
  status.className = "error";
  saveButton.disabled = true;
}

saveButton.addEventListener("click", async () => {
  saveButton.disabled = true;
  saveButton.textContent = "Saving…";
  status.textContent = "";
  status.className = "";

  const note = noteField.value.trim();
  const result = await chrome.runtime.sendMessage({
    type: "capture",
    tabId: tab.id,
    extra: note ? { note } : {},
  });

  if (result?.ok) {
    saveButton.textContent = "Saved";
    status.textContent = result.title ?? "It's in your inbox.";
    // Long enough to read the confirmation, short enough not to be in the way.
    setTimeout(() => window.close(), 900);
  } else {
    saveButton.disabled = false;
    saveButton.textContent = "Save it";
    status.textContent = result?.error ?? "That didn't work.";
    status.className = "error";
  }
});
