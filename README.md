# CA Attendance Manager

Article attendance, assignment cycle tracking, and workload monitoring for CA offices.

**Stack:** Next.js 15 · Supabase (PostgreSQL + Auth + Realtime) · Tailwind CSS · Netlify

---

## Prerequisites

Before you begin, install:

- [Node.js 20+](https://nodejs.org/) — check with `node -v`
- [Supabase CLI](https://supabase.com/docs/guides/cli) — `npm install -g supabase`
- A [Supabase account](https://supabase.com) (free tier is enough for development)
- A [Google Cloud](https://console.cloud.google.com) project (for OAuth)

---

## 1. Clone and Install

```bash
# In your terminal
cd "path/to/your/projects"
npm install
```

---

## 2. Create a Supabase Project

1. Go to [supabase.com](https://supabase.com) → **New project**
2. Give it a name (e.g. `ca-attendance`), set a database password, choose a region close to India (Singapore or Mumbai)
3. Wait ~2 minutes for the project to provision
4. Go to **Project Settings → API**
5. Copy:
   - **Project URL** → this is your `NEXT_PUBLIC_SUPABASE_URL`
   - **anon / public** key → this is your `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - **service_role / secret** key → this is your `SUPABASE_SERVICE_ROLE_KEY`

---

## 3. Set Up Google OAuth

1. Go to [Google Cloud Console](https://console.cloud.google.com) → **APIs & Services → Credentials**
2. Click **Create Credentials → OAuth 2.0 Client ID**
3. Application type: **Web application**
4. Add Authorised Redirect URIs:
   ```
   https://YOUR-PROJECT-REF.supabase.co/auth/v1/callback
   http://localhost:54321/auth/v1/callback
   ```
   *(Replace `YOUR-PROJECT-REF` with your actual Supabase project reference — visible in the project URL)*
5. Click **Create** — copy the **Client ID** and **Client Secret**
6. In your Supabase dashboard: **Authentication → Providers → Google**
   - Toggle **Enable**
   - Paste Client ID and Client Secret
   - Save

---

## 4. Configure Environment Variables

```bash
cp .env.example .env.local
```

Open `.env.local` and fill in every value:

```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...
SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_ANON_KEY=eyJ...
GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-your-secret
NEXT_PUBLIC_APP_URL=http://localhost:3000
CRON_SECRET=generate-a-random-32-char-string
```

To generate a secure `CRON_SECRET`:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

---

## 5. Run Database Migrations

Migrations must be run **in order**. Open your Supabase project → **SQL Editor** → paste and run each file:

| Order | File | What it does |
|-------|------|--------------|
| 1 | `supabase/migrations/00001_init_schema.sql` | Creates all 7 tables, enums, and indexes |
| 2 | `supabase/migrations/00002_rls_policies.sql` | Row-Level Security — who can see/edit what |
| 3 | `supabase/migrations/00003_functions.sql` | Database functions, triggers, and RPCs |
| 4 | `supabase/migrations/00004_realtime.sql` | Enables live dashboard updates |
| 5 | `supabase/migrations/00005_bootstrap_admin.sql` | Creates the first-admin helper function |
| 6 | `supabase/migrations/00006_fix_profile_trigger.sql` | Fixes profile auto-creation trigger |
| 7 | `supabase/migrations/00007_remove_cycles.sql` | Removes cycle lifecycle from app layer |
| 8 | `supabase/migrations/00008_stabilization.sql` | Security checks + IST timezone fixes on RPCs |

**How to run each migration:**
1. Open Supabase Dashboard → SQL Editor → **New query**
2. Open the `.sql` file in a text editor, select all, copy
3. Paste into the SQL editor → **Run**
4. You should see `Success. No rows returned`
5. Repeat for each file in order

> **Note:** Migrations 00007 and 00008 are safe to run multiple times — they use `DROP IF EXISTS` before recreating functions.

---

## 6. Create the First Admin

After migrations are applied, you need to promote the first admin user. There is a chicken-and-egg problem: all sign-ins start as "pending", and there is nobody to approve them yet.

**Steps:**

1. Run the app locally (see step 7 below)
2. Open `http://localhost:3000` in your browser
3. Click **Continue with Google** and sign in with the account that should be the first admin
4. You will see the "Awaiting Access" screen — **this is expected**
5. Go back to Supabase → **SQL Editor → New query**
6. Run this, replacing the email:

```sql
UPDATE public.profiles
SET role = 'admin', status = 'active'
WHERE email = 'your-email@yourdomain.com';
```

7. Confirm the query returns `1 row affected`. If it returns 0, the profile was not created — the sign-in did not complete successfully.
8. Go back to the browser and refresh — you will be redirected to the dashboard

**Note:** The `bootstrap_first_admin()` helper function was removed in migration 00019. The direct UPDATE above is equivalent and requires no helper function.

---

## 7. Run Locally

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

The app will:
- Redirect to `/login` if not signed in
- Redirect to `/awaiting` if signed in but not approved
- Redirect to `/attend` for articles
- Redirect to `/dashboard` for managers, partners, and admins

---

## 8. Test the Login Flow

### First-time sign in (new user):
1. Open the app → click **Continue with Google**
2. Select any Google account
3. You should land on the `/awaiting` page
4. The page polls every 8 seconds — it will auto-redirect once approved

### Approve a user (admin):
1. Sign in as admin → go to `/users`
2. Find the user under the **Pending** tab
3. Click **Approve**, select their role, confirm
4. Their awaiting page auto-redirects within 8 seconds

### Article check-in flow:
1. Sign in as an article → you land on `/attend`
2. Click **Check In**
3. Browser will ask for location permission — click **Allow**
4. Search for a client name in the search box
5. Select an assignment
6. Add an optional note → click **Confirm Check In**
7. You should see the check-in card appear with time and a Maps link
8. When finished, click **Check Out** — GPS is captured again

### Dashboard realtime:
1. Open `/dashboard` as admin in one tab
2. Open `/attend` as an article in another tab (or different browser)
3. Check in as the article
4. The dashboard should update within 1–2 seconds without refreshing

---

## 9. Deploy to Netlify

1. Push your code to a GitHub repository
2. Go to [netlify.com](https://netlify.com) → **Add new site → Import from Git**
3. Select your repository
4. Build settings (should auto-detect):
   - Build command: `npm run build`
   - Publish directory: `.next`
5. Add the Netlify Next.js plugin if prompted
6. Go to **Site settings → Environment variables** and add all variables from `.env.example`
7. For `NEXT_PUBLIC_APP_URL` use your Netlify domain (e.g. `https://your-site.netlify.app`)
8. Add the Netlify domain to your Google OAuth **Authorised Redirect URIs**:
   ```
   https://YOUR-PROJECT-REF.supabase.co/auth/v1/callback
   ```
   *(This is Supabase's redirect URI — it doesn't change between environments)*
9. In Supabase → **Authentication → URL Configuration**, add your Netlify URL to **Redirect URLs**:
   ```
   https://your-site.netlify.app/**
   ```
10. Trigger a deploy

---

## Folder Structure

```
attendance-manager/
├── supabase/migrations/     # Run these in Supabase SQL Editor in order
├── src/
│   ├── app/
│   │   ├── (auth)/          # Login, Awaiting, Deactivated pages
│   │   ├── (article)/       # Article attendance screen (/attend)
│   │   ├── (admin)/         # Dashboard, Assignments, Users, Reports
│   │   └── api/             # All server-side API routes
│   ├── components/          # Reusable UI components
│   ├── hooks/               # React hooks (GPS, attendance session, dashboard)
│   ├── lib/                 # Supabase clients, GPS logic, Excel export, utils
│   └── types/               # TypeScript type definitions
└── .env.example             # Copy to .env.local and fill in
```

---

## Common Issues

**"GPS not available" on desktop during development**
GPS requires HTTPS or localhost. The app works on `http://localhost:3000`. If testing on a local network IP (e.g. `192.168.x.x`), GPS will be blocked by the browser — use `localhost` or deploy to HTTPS.

**Google sign-in redirects to wrong URL**
Make sure the Redirect URI in Google Cloud Console exactly matches `https://YOUR-PROJECT-REF.supabase.co/auth/v1/callback`. The project ref is the string in your Supabase project URL.

**Migrations fail with "extension does not exist"**
Run migrations in order (00001 first). The pg_trgm extension is set up in 00001 — if you run 00003 first it will fail.

**Migrations 00007/00008 fail with "cannot change return type"**
Run 00008 directly — it explicitly drops and recreates all affected functions before recreating them. It is safe to run even if 00007 previously failed.

**UPDATE returns 0 rows when promoting the first admin**
You must sign in with Google at least once before running the UPDATE. The "Awaiting Access" screen appearing confirms the profile row was created.

**"You have an unclosed check-in" on a prior date**
An admin can regularize the unclosed attendance record by setting `checked_out_at` to an appropriate timestamp from the Supabase Table Editor, then the article can check in normally.
