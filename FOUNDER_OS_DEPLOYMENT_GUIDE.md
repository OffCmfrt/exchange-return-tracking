# Founder OS — Deployment Guide

The Founder OS dashboard (`offcomfrt-founder-os.jsx`) is now a fully functional,
cloud-synced app:

- **Frontend** → Shopify page (`templates/page.founder-os.liquid`)
- **App bundle** → Shopify theme asset (`assets/founder-os.js`, 149 KB)
- **Backend** → Render (`exchange-return-tracking.onrender.com`)
- **Storage** → Supabase table `founder_os_state` (state syncs across devices,
  with localStorage as an offline fallback)
- **Auth** → login gate reusing the existing admin JWT login (ADMIN_PASSWORD)

---

## Step 1 — Create the Supabase table

1. Open **Supabase Dashboard → SQL Editor**
2. Paste and run the full contents of `supabase_migration_founder_os.sql`:

```sql
CREATE TABLE IF NOT EXISTS founder_os_state (
    key TEXT PRIMARY KEY,
    state JSONB NOT NULL DEFAULT '{}',
    updated_by TEXT,
    updated_at TIMESTAMPTZ DEFAULT now(),
    created_at TIMESTAMPTZ DEFAULT now()
);
```

This stores the entire workspace (tasks, projects, departments, meetings,
decisions, delegation, goals, weekly reviews, personal log) as one JSONB row.

---

## Step 2 — Deploy the backend to Render

The new endpoints are already in `server.js`:

- `GET  /api/founder-os/state` — load workspace state (admin token required)
- `PUT  /api/founder-os/state` — upsert workspace state (admin token required)

Both are protected by the existing `authenticateAdmin` JWT middleware and are
exempt from rate limiting (authenticated requests skip the limiters).
The JSON body limit was raised to 2 MB so large workspaces save cleanly.

No new environment variables are needed (`ADMIN_PASSWORD`, `JWT_SECRET`,
`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` already exist on Render).

```bash
git add -A
git commit -m "Add Founder OS cloud-synced workspace (Supabase + Shopify page)"
git push origin main
# Render auto-deploys
```

### Verify

```bash
# Get a token
curl -X POST https://exchange-return-tracking.onrender.com/api/admin/login \
  -H 'Content-Type: application/json' -d '{"password":"<ADMIN_PASSWORD>"}'

# Load state (returns {"success":true,"state":null} on a fresh install)
curl https://exchange-return-tracking.onrender.com/api/founder-os/state \
  -H 'Authorization: Bearer <token>'
```

---

## Step 3 — Deploy the frontend on Shopify

1. **Shopify Admin → Online Store → Themes → ⋯ → Edit code**
2. **Assets → Add a new asset** → upload `public/founder-os.js`
   (must be named exactly `founder-os.js`)
3. **Templates → Add a new template** → type: *page*, name: `founder-os`
   → replace its contents with `public/page.founder-os.liquid`
4. **Online Store → Pages → Add page** → title it **Founder OS**,
   assign the `page.founder-os` template, save

The page loads React/ReactDOM/PropTypes/Recharts from CDN and the app bundle
from theme assets, then shows the login gate.

---

## How it works

1. Visiting the page shows a sign-in card (OFFCOMFRT / Founder OS).
2. Sign in with the **admin password** (leave username empty for super admin,
   or use an operator username + password).
3. The app loads state from Supabase; if nothing is stored yet it seeds the
   sample workspace and saves it on the first change.
4. Every change is saved locally instantly and pushed to Supabase
   (debounced ~1.4 s), so all devices see the same data.
5. If the backend is unreachable, the app keeps working from the
   localStorage cache and resumes syncing when back online.
6. Expired sessions (JWT, 24 h) automatically return to the login gate.

---

## Rebuilding the bundle

If `offcomfrt-founder-os.jsx` changes, copy it over and rebuild:

```bash
cp offcomfrt-founder-os.jsx .ref-preview/src/FounderOS.jsx
cd .ref-preview
NODE_ENV=production ./node_modules/.bin/esbuild build-founder-os.jsx \
  --bundle --minify --format=iife --target=es2019 \
  --alias:react=./shims/react.cjs \
  --alias:react-dom/client=./shims/react-dom-client.cjs \
  --alias:react-dom=./shims/react-dom.cjs \
  --alias:prop-types=./shims/prop-types.cjs \
  --alias:recharts=./shims/recharts.cjs \
  --outfile=../public/founder-os.js
```

Then re-upload `public/founder-os.js` to Shopify theme assets.
The CDN script versions in the liquid file must stay aligned with the shims
(React 18.3.1, Recharts 2.12.7, PropTypes 15.8.1).
