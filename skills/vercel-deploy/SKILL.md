---
name: Vercel Deploy
description: Connect a Vite + React SPA to Vercel via Git integration, configure environment variables, and enable push-to-deploy from GitHub.
---

# Skill: Vercel Deploy

Connect a Vite + React SPA to Vercel, configure environment variables, and enable push-to-deploy from GitHub.

---

## One-time manual setup (human required)

1. Go to [vercel.com](https://vercel.com) → **Add New Project** → **Import Git Repository**
2. Select the GitHub repo; Vercel will detect **Vite** automatically
3. Leave build settings as-is (framework: Vite, build command: `npm run build`, output: `dist`)
4. Before clicking Deploy, open **Environment Variables** and add:

| Name | Where used |
|------|-----------|
| `VITE_SUPABASE_URL` | Client-side — Supabase project URL |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Client-side — Supabase anon/public key |
| `VITE_SUPABASE_PROJECT_ID` | Client-side — Supabase project ref |
| `OPENROUTER_API_KEY` | Edge functions only (not Vercel) |
| `OPENROUTER_MODEL` | Edge functions only (not Vercel) |

> **Note:** `VITE_*` vars are bundled into the client-side JS by Vite at build time.
> `OPENROUTER_*` are secrets used only by Supabase Edge Functions — Vercel never executes
> those. Still set them in Vercel for completeness, or skip if you prefer to keep them only
> in the Supabase dashboard. This setup needs **no** service-role key; `SUPABASE_URL` and
> `SUPABASE_ANON_KEY` are auto-injected into Edge Functions by Supabase.

5. Click **Deploy**

---

## SPA routing fix (`vercel.json`)

Because this app uses `react-router-dom` with `BrowserRouter`, every route must be served by `index.html`. Without a rewrite rule, navigating directly to `/sign-in` on Vercel returns 404.

`vercel.json` at the repo root handles this:

```json
{
  "rewrites": [
    { "source": "/(.*)", "destination": "/index.html" }
  ]
}
```

This file is already committed. Do not remove it.

---

## After the first deploy

- Every `git push` to `main` triggers an automatic Vercel deployment (no manual CLI step needed).
- Preview deployments are created for every pull request automatically.
- To sync env vars locally: `vercel env pull .env.local` (requires Vercel CLI + `vercel link`).

---

## Smoke test checklist

After the live URL is up:

- [ ] Home page loads (no blank screen, no console errors)
- [ ] `/sign-in` route loads directly (tests the SPA rewrite rule)
- [ ] Sign in with the test account succeeds
- [ ] A chat message round-trip works (tests Supabase edge function connectivity)

---

## Common gotchas

| Problem | Cause | Fix |
|---------|-------|-----|
| Blank page after deploy | `VITE_*` vars missing in Vercel | Add them in Project → Settings → Environment Variables, then redeploy |
| Direct URL returns 404 | Missing `vercel.json` rewrites | Ensure `vercel.json` with the `/(.*) → /index.html` rewrite is committed |
| Auth redirects fail | Wrong Supabase redirect URL | Add your Vercel domain to Supabase → Authentication → URL Configuration → Redirect URLs |
| Build fails with `lovable-tagger` | Dev dependency tree issue | Ensure `lovable-tagger` is in `devDependencies`, not `dependencies` |

---

## Supabase redirect URL for the live domain

After getting your Vercel domain (e.g. `https://your-app.vercel.app`), add it to Supabase:

1. Supabase Dashboard → **Authentication** → **URL Configuration**
2. **Site URL**: set to your Vercel domain
3. **Redirect URLs**: add `https://your-app.vercel.app/**`

This is required for magic links, OAuth, and password reset emails to redirect correctly.
