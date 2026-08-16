# Capturing things — the share sheet and the extension

Two clients feed `/api/capture`, and they both work the same way: a `fitr_…`
token in an `Authorization` header, a small JSON body, one request. Set either
up in a few minutes; set both up and you can save something from anywhere.

Everything below needs your capture token first.

## 0. Get your token

Open **Settings** in fitr → **Capture token** → **Create a token**. Copy it.

It looks like `fitr_a9F3kQ…`. It can do exactly one thing — add a row to your
inbox — and **Regenerate** revokes the old one the moment you press it. If you
ever paste it somewhere public, regenerate and carry on; nothing else in the
app is reachable with it.

Check it works:

```bash
curl -H "Authorization: Bearer fitr_YOUR_TOKEN" https://YOUR-APP.vercel.app/api/capture
# {"ok":true,"message":"Token is good. Captures will land in your inbox."}
```

That `GET` exists precisely so this step can be checked before you go and build
a Shortcut around it.

---

## 1. The iOS Shortcut — sharing from TikTok, Instagram, Safari

The target is: see a fit you like, tap Share, tap fitr, get back to scrolling.
Under five seconds, which means no prompts and no confirmation screens.

### Build it

Open **Shortcuts** → **+** → name it **fitr**.

1. **Set up the share sheet.** Tap the ⓘ (or the shortcut's name → Details):
   - Turn on **Show in Share Sheet**
   - **Share Sheet Types**: turn everything off except **URLs** and **Text**
     — leaving images on makes it appear for photos it can't handle.

2. **Add: Text**
   Set the content to exactly this, with your real values substituted:

   ```json
   {"sourceUrl": "SHORTCUT_INPUT", "source": "other"}
   ```

   Then select the words `SHORTCUT_INPUT` inside the quotes, delete them, and
   insert the **Shortcut Input** variable in their place. The quotes must stay.

3. **Add: Get Contents of URL**
   - URL: `https://YOUR-APP.vercel.app/api/capture`
   - Expand **Show More**:
     - **Method**: `POST`
     - **Headers**: add `Authorization` → `Bearer fitr_YOUR_TOKEN`
       (the word `Bearer`, a space, then the token)
     - **Request Body**: `File`
     - Then pick the **Text** variable from step 2 as the body.

   `File` rather than `JSON` is the fiddly bit. The `JSON` body builder makes
   you construct the object field by field in the UI, and it will happily send
   your URL as a nested dictionary that the endpoint can't read. Handing it the
   text you already built is simpler and does what it looks like it does.

4. Optionally **Add: Show Notification** with the result, while you're testing.
   Delete it once it works — a share that says nothing is a share you'll keep
   using.

### Use it

In TikTok: **Share → More → fitr**. In Safari: **Share → fitr**. It lands in
your inbox with whatever the page said about itself.

### When it doesn't work

The endpoint returns readable JSON for every failure, so add a temporary
**Show Notification** step showing the response and it will tell you which:

| What it says | What to do |
|---|---|
| `Bad or missing capture token` | The header is wrong. It's `Authorization`, and the value starts with `Bearer ` including the space. |
| `Expected a JSON body` | The Request Body is set to `JSON` or `Form`. Set it to `File` and pass the Text variable. |
| `Send at least a link, an image, or a note` | The Shortcut Input variable didn't get inserted — the body is the literal text, not your URL. |
| Nothing at all, spins forever | Check the URL. It ends in `/api/capture` with no trailing slash. |

**On TikTok specifically:** a shared TikTok URL carries almost no metadata a
server can read, so the capture will usually be a bare link with no picture.
That's expected and it's fine — the link is what you wanted. Discovery works
from what you type on the want, not from the video.

---

## 2. The browser extension — saving from a laptop

This one earns its keep on the pages `/api/import/url` can't read. Uniqlo, Zara,
the big chains: they build the product page in the browser, so a server fetch
sees an empty shell. The extension runs *inside* the rendered page and can read
what you're looking at — and it fetches the product image from there too, with
the page's own referrer, so CDNs that refuse a bare server request hand it over.

### Install it

Chrome, Edge, Brave, or Arc:

1. Go to `chrome://extensions`
2. Turn on **Developer mode** (top right)
3. **Load unpacked** → select the `extension/` folder in this repo
4. Pin it to the toolbar

It's unpacked because it's yours. Putting it on the Web Store would mean a
developer account, a review queue, and a privacy policy, for a one-user tool.
The cost is that Chrome will nag about developer mode occasionally.

### Set it up

Right-click the extension icon → **Options**, and fill in:

- **Your fitr address** — `https://YOUR-APP.vercel.app`
- **Capture token** — the same `fitr_…` token

Press **Save and test**. Chrome will ask permission to access that address —
this must be accepted, and it's asked for at that moment rather than at install
because the extension has no idea where your fitr lives until you tell it. The
button then makes a real request with your token and reports what came back, so
a wrong token is wrong here rather than three days from now on a product page.

### Use it

- **Click the icon** → shows the page, takes an optional note, saves.
- **Right-click anywhere** → *Save to fitr*. Right-clicking a specific image
  captures that image; selecting text first attaches it as a note.

### What it can't do

Chrome blocks extensions on `chrome://` pages, the Web Store, and other
extensions' pages. You'll get "Couldn't read this page", which is Chrome's rule
rather than a bug worth reporting.

---

## 3. Price alerts on your phone (optional)

Notifications are opt-in and nothing depends on them — every price drop appears
on `/watch` regardless. Set them up if you want to be interrupted.

**On a laptop:** Settings → Price alerts → **Enable notifications**. Done.

**On an iPhone, there's an extra step, and it's not optional.** Safari will not
deliver a push to a website. The page has to be installed to the home screen
first:

1. Open fitr in Safari
2. **Share → Add to Home Screen**
3. Open fitr **from the home screen icon**, not from Safari
4. Settings → Price alerts → **Enable notifications**

Doing this from Safari instead of the installed app produces no button and no
error, because the Push API simply isn't there. Settings says so when it detects
an iPhone, which is the only reason that particular message exists.

If Price alerts says *"Not set up on the server"*, the VAPID keys are missing
from the deployment — see the push section of [`SETUP.md`](../SETUP.md).

---

## The endpoint itself

For anything else you want to wire up — a Raycast script, an Apple Watch
complication, a cron that saves a daily drop:

```
POST /api/capture
Authorization: Bearer fitr_…
Content-Type: application/json

{
  "sourceUrl":   "https://…",     // optional
  "source":      "tiktok" | "instagram" | "web" | "photo" | "other",
  "title":       "…",             // optional; read from the page if absent
  "note":        "…",             // optional
  "imageBase64": "…",             // optional, no data: prefix, under ~6MB
  "contentType": "image/jpeg"     // required if imageBase64 is present
}
```

At least one of `sourceUrl`, `imageBase64`, or `note` must be present. Given a
URL and nothing else, the server reads the page for a title, brand, price and
image before saving — best-effort, on a six-second budget, and a page it can't
read costs you nothing but the metadata.

Answers `201` with `{ok: true, captureId, title, imageUrl}`, or a `4xx`/`5xx`
with `{ok: false, error}` in plain words.
