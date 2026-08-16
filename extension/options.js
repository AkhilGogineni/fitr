/*
 * Settings, and the permission request that has to happen here.
 *
 * The manifest asks for no host permissions up front. It can't sensibly: the
 * address of your fitr deployment isn't known until you type it, and an
 * extension that asks for access to every site you visit in order to talk to
 * exactly one of them is asking for far more than it needs.
 *
 * So the origin is requested at the moment it's entered, from a click — which
 * is the only context Chrome will show the prompt in. Getting this wrong is the
 * classic MV3 failure: settings save fine, and every capture then fails with an
 * opaque network error because the fetch was never allowed.
 *
 * It also tests the credential immediately. A token that's wrong should be
 * wrong here, in a page with a message on it, not silently on a product page
 * three days from now.
 */

const baseUrlField = document.getElementById("baseUrl");
const tokenField = document.getElementById("token");
const saveButton = document.getElementById("save");
const status = document.getElementById("status");

const stored = await chrome.storage.sync.get(["baseUrl", "token"]);
baseUrlField.value = stored.baseUrl ?? "";
tokenField.value = stored.token ?? "";

function report(message, isError = false) {
  status.textContent = message;
  status.className = isError ? "error" : "";
}

saveButton.addEventListener("click", async () => {
  const raw = baseUrlField.value.trim().replace(/\/$/, "");
  const token = tokenField.value.trim();

  let origin;
  try {
    origin = new URL(raw).origin;
  } catch {
    report("That doesn't look like a URL. It should start with https://", true);
    return;
  }

  if (!token.startsWith("fitr_")) {
    report("A capture token starts with fitr_ — copy it from Settings.", true);
    return;
  }

  saveButton.disabled = true;
  report("Asking for permission…");

  const granted = await chrome.permissions.request({ origins: [`${origin}/*`] });
  if (!granted) {
    saveButton.disabled = false;
    report(
      "Without permission for that address the extension can't send anything to it.",
      true,
    );
    return;
  }

  report("Testing the token…");
  try {
    const response = await fetch(`${raw}/api/capture`, {
      headers: { authorization: `Bearer ${token}` },
    });
    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      saveButton.disabled = false;
      report(payload.error ?? `fitr answered ${response.status}.`, true);
      return;
    }

    await chrome.storage.sync.set({ baseUrl: raw, token });
    report("Saved, and the token works. Right-click any page to save it.");
  } catch {
    saveButton.disabled = false;
    report(`Couldn't reach ${raw}. Is the app deployed and the address right?`, true);
    return;
  }

  saveButton.disabled = false;
});
