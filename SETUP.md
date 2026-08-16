# Setup

Roughly 15 minutes, all on free tiers. Nothing here needs a credit card.

You do these steps rather than Claude, because they involve creating accounts
and handling your own credentials.

---

## 1. Supabase — database and auth

1. Create a project at [supabase.com](https://supabase.com) (free tier, 2 projects allowed).
2. **Project Settings → API**: copy the **Project URL** and the **anon public** key
   into `.env.local` as `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
3. **Project Settings → API**: also copy the **service_role** key into
   `.env.local` as `SUPABASE_SERVICE_ROLE_KEY`. It bypasses RLS entirely, so it
   never gets a `NEXT_PUBLIC_` prefix and never goes near a Client Component.
   Exactly two routes use it, both because their callers have no session to act
   as: `/api/capture` (an iOS Shortcut with a bearer token) and
   `/api/cron/prices` (a scheduled job acting for nobody).
4. **SQL Editor → New query**: run the migrations in `supabase/migrations` in
   filename order — `0001_initial_schema.sql`, `0002_intake.sql`,
   `0003_revoke_anon.sql`, then `0004_daily_capture_watch.sql`. Paste each file
   whole and run it.
   - `0002` adds the `needs_review` flag that intake sets and the review grid clears.
   - `0003` closes a grant that `0001` left open — see the isolation check at the
     foot of this file.
   - `0004` adds the daily suggestion log, the capture token, push subscriptions,
     and the columns discovery and the price watch need.
5. **Authentication → Sign In / Providers → Email**: turn **Confirm email** *off*.

   Why: the free tier's built-in SMTP allows only a couple of emails per hour, so
   confirmation mail turns signing into your own app into a waiting game. Fine for a
   personal instance; turn it back on before anyone else uses this.

> The free tier pauses a project after 7 days with no requests. Once the Phase 6
> price cron is running it pings daily and this stops being a concern.

## 2. Cloudflare R2 — image storage

Free tier is 10GB with **zero egress fees**, versus Supabase Storage's 1GB. A
250-item wardrobe with originals plus cutouts runs 300–600MB, so this is the
difference between comfortable and cramped.

1. In the Cloudflare dashboard, go to **R2** and create a bucket named `fitr`.
   (R2 asks for a card to activate even on the free plan; it does not charge
   within free limits. If you'd rather not, see the fallback below.)
2. **R2 → Manage API Tokens → Create API Token**, with **Object Read & Write**
   scoped to the `fitr` bucket. Copy the Access Key ID and Secret Access Key.
3. Your **Account ID** is in the R2 sidebar → `R2_ACCOUNT_ID`.
4. **Bucket → Settings → Public access**: enable the `r2.dev` subdomain and copy
   that URL into `R2_PUBLIC_BASE_URL`.
5. **Bucket → Settings → CORS policy**: add the rule below.

   ```json
   [
     {
       "AllowedOrigins": ["http://localhost:3000", "https://YOUR-APP.vercel.app"],
       "AllowedMethods": ["PUT", "GET"],
       "AllowedHeaders": ["content-type"],
       "MaxAgeSeconds": 3600
     }
   ]
   ```

   Why it matters: photos go from the browser straight to R2 using a presigned
   URL, so the bytes never pass through the app server. Without this rule the
   browser blocks that request before it is sent, and the only symptom is a
   generic "Upload was blocked by the browser" on every item. Add your Vercel
   domain here too when you deploy.

**Fallback if you'd rather skip the card:** Supabase Storage works with the same
interface. Say so and I'll swap `src/lib/r2.ts` for a Supabase Storage adapter —
it's an afternoon, and the 1GB ceiling is survivable for the 30-item pilot.

## 3. Gemini — tagging and discovery

Not needed to boot; Phase 1 is the first phase that calls it.

Get a key at [aistudio.google.com/apikey](https://aistudio.google.com/apikey) →
`GEMINI_API_KEY`.

`GEMINI_MODEL` is optional and defaults to `gemini-3.6-flash`. Google renames and
retires these regularly, and which ones a given key may call for free changes
independently of that — so if tagging reports that the model isn't available to
your key, set this variable rather than editing code. Everything else still
works without a key at all: items save untagged and you fill in the category in
the review grid.

Free tier gives roughly 1,000 requests/day plus **5,000 Google-Search-grounded
prompts/month**, which is what makes unbiased product discovery possible at $0.

> Google's free tier reserves the right to use submitted data. That covers photos
> of your clothes. Tagging sits behind a provider-agnostic interface, so switching
> to a paid key later is a small change.

## 4. Run it

```bash
npm run dev
```

Open http://localhost:3000, create an account, and you should land on an empty
wardrobe. **Add pieces** takes you to intake.

The first visit to intake downloads the background-removal model — about 44MB,
cached by the browser afterwards. On a machine with WebGPU a garment takes about
a second to cut out; without it, the same work runs on the CPU and takes several.
The header says which one you got.

## 4b. Where you live, and what you'll spend

Two things the app has to be told rather than infer. Open **Settings** once
you're signed in:

- **Where you live** — type a place, or use the browser's location. Without it
  the daily suggestion still works, it just can't factor in the weather, and
  every temperature rule sits out. Stored to four decimal places, roughly a
  city block.
- **What you'll pay** — a ceiling per category. Discovery filters against these,
  so a coat ceiling and a t-shirt ceiling being different is the whole point.
  Sensible defaults are already in place; adjust and forget.

## 5. Deploy

Import the repo at [vercel.com](https://vercel.com) on the Hobby plan and paste the
same environment variables into **Project Settings → Environment Variables**.

Worth doing before Phase 3 — the daily "what do I wear today" screen is a phone
feature, and it wants a real URL. The share sheet, the browser extension and the
price cron all need one too.

## 6. The share sheet and the extension

Both are set up from [`docs/CAPTURE.md`](docs/CAPTURE.md), and both need a
capture token from **Settings → Capture token**. Ten minutes for the iOS
Shortcut, three for the extension.

The extension is worth doing even if the Shortcut isn't: it reads the *rendered*
page, which is the only thing that works on the large chains that build their
product pages in the browser.

## 7. The price cron

The daily price check runs from GitHub Actions rather than Vercel Cron — 2,000
free minutes a month against Hobby's two jobs, and it keeps the Supabase free
tier from pausing after seven idle days as a side effect.

1. Make a secret:

   ```bash
   openssl rand -base64 32
   ```

2. Set it as `CRON_SECRET` **in both places** — Vercel's environment variables
   and the repo's **Settings → Secrets and variables → Actions**. They have to
   match; the route compares them.
3. Add a second repository secret `APP_URL`, your deployed address
   (`https://your-app.vercel.app`, no trailing slash).
4. **Actions → Price watch → Run workflow** to try it without waiting a day.

Check it's wired up at any time:

```bash
curl https://YOUR-APP.vercel.app/api/cron/prices
# {"ok":true,"push":true,"message":"Ready. POST here with the cron secret to run a check."}
```

`ok: false` means `CRON_SECRET` isn't set on the deployment. `push: false` means
notifications aren't configured, which is fine — drops still land on `/watch`.

## 8. Push notifications (optional)

Skip this and nothing breaks. Every price drop appears on `/watch` either way;
this only adds the interruption.

```bash
npx web-push generate-vapid-keys
```

Put the pair in the environment as `NEXT_PUBLIC_VAPID_PUBLIC_KEY` and
`VAPID_PRIVATE_KEY`, plus `VAPID_SUBJECT=mailto:you@example.com` — a contact
address the push services use if your notifications start misbehaving. The
public key is public by necessity: the browser needs it to subscribe.

Then **Settings → Price alerts → Enable notifications**.

> **On iPhone there's one more step and it isn't optional.** Safari won't
> deliver a push to a website. Open fitr in Safari → **Share → Add to Home
> Screen**, open it *from that icon*, and enable notifications there. From
> Safari itself the button never appears, because the Push API isn't present —
> Settings says so when it detects an iPhone.

Rotating the VAPID keys invalidates every existing subscription, and each device
has to be re-enabled. Generate them once.

---

## Verifying data isolation

The whole multi-user-later story rests on RLS actually working, so prove it rather
than assume it. Create a second account, sign in as them, and confirm the wardrobe
is empty even after the first account has items in it.

Then, in the Supabase SQL editor:

```sql
-- Expected after 0003: "permission denied for table items".
-- Before 0003 this returns 0 instead — which is what prompted that migration.
set role anon;
select count(*) from items;
reset role;
```

That `0` was worth chasing down. No rows were ever exposed: every policy is
`to authenticated`, so an anon caller matches none of them and RLS returns
nothing. But `0001` only *granted* to `authenticated` and never *revoked* from
`anon`, and Postgres hands out a default SELECT grant regardless — so the count
succeeded and returned zero rows rather than being refused outright. One lock was
doing the work of two. `0003` revokes it, including for tables added later.

Two separate mechanisms are at work and both matter:

- **Grants** decide whether a role may touch a table at all.
- **RLS** decides which rows it sees once it may.

The grant layer earns its place by failing closed on its own: if a later
migration adds a table and forgets a policy, the missing grant still refuses.

Supabase changed the default here in May 2026 — new projects no longer expose
tables to the API automatically. The migration issues the grants explicitly, so
if you ever add a table by hand and get a mysterious permissions error, a missing
`grant` is the first thing to check.
