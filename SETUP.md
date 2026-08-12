# Setup

Roughly 15 minutes, all on free tiers. Nothing here needs a credit card.

You do these steps rather than Claude, because they involve creating accounts
and handling your own credentials.

---

## 1. Supabase — database and auth

1. Create a project at [supabase.com](https://supabase.com) (free tier, 2 projects allowed).
2. **Project Settings → API**: copy the **Project URL** and the **anon public** key
   into `.env.local` as `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
3. **SQL Editor → New query**: paste the whole of
   `supabase/migrations/0001_initial_schema.sql` and run it.
4. **Authentication → Sign In / Providers → Email**: turn **Confirm email** *off*.

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

**Fallback if you'd rather skip the card:** Supabase Storage works with the same
interface. Say so and I'll swap `src/lib/r2.ts` for a Supabase Storage adapter —
it's an afternoon, and the 1GB ceiling is survivable for the 30-item pilot.

## 3. Gemini — tagging and discovery

Not needed to boot; Phase 1 is the first phase that calls it.

Get a key at [aistudio.google.com/apikey](https://aistudio.google.com/apikey) →
`GEMINI_API_KEY`.

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
wardrobe.

## 5. Deploy (optional until Phase 3)

Import the repo at [vercel.com](https://vercel.com) on the Hobby plan and paste the
same environment variables into **Project Settings → Environment Variables**.

Worth doing before Phase 3 — the daily "what do I wear today" screen is a phone
feature, and it wants a real URL.

---

## Verifying data isolation

The whole multi-user-later story rests on RLS actually working, so prove it rather
than assume it. Create a second account, sign in as them, and confirm the wardrobe
is empty even after the first account has items in it.

Then, in the Supabase SQL editor:

```sql
-- Expected: "permission denied for table items".
-- anon is granted nothing at all, so it fails at the grant layer before RLS is
-- even consulted. Two independent locks, not one.
set role anon;
select count(*) from items;
reset role;
```

Two separate mechanisms are at work and both matter:

- **Grants** decide whether a role may touch a table at all.
- **RLS** decides which rows it sees once it may.

Supabase changed the default here in May 2026 — new projects no longer expose
tables to the API automatically. The migration issues the grants explicitly, so
if you ever add a table by hand and get a mysterious permissions error, a missing
`grant` is the first thing to check.
