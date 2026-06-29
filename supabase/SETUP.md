# Turning on the live community (Supabase)

The app works with **zero** backend — built-in devices + the static
`community-devices.json`. The steps below add a **live, shared community
library** and **Google sign-in**, for free, while the site stays on GitHub
Pages and keeps auto-deploying on every commit.

If you skip all of this, nothing breaks: the Community menu simply stays
hidden and the app behaves exactly as before.

---

## 1. Create the Supabase project (free)

1. Go to <https://supabase.com> → sign in → **New project**.
2. Pick a name, a strong database password, and the closest region. Free tier.
3. Wait ~2 minutes for it to provision.

> Heads-up: free projects **pause after ~1 week of no activity**. The first
> visitor after a pause waits a few seconds while it wakes. Fine for a hobby
> community.

## 2. Create the table + security rules

1. In the project: **SQL Editor → New query**.
2. Paste the whole of [`schema.sql`](./schema.sql) and click **Run**.

This creates the `devices` table and the row-level-security policies that let
guests read but only signed-in users post their own devices.

## 3. Enable Google sign-in

You need a Google OAuth client (free, in Google Cloud):

1. <https://console.cloud.google.com> → **APIs & Services → Credentials →
   Create credentials → OAuth client ID → Web application**.
2. Under **Authorized redirect URIs**, add your Supabase callback:
   `https://<YOUR-PROJECT-REF>.supabase.co/auth/v1/callback`
   (find `<YOUR-PROJECT-REF>` in Supabase → Project Settings → API → Project URL).
3. Copy the generated **Client ID** and **Client secret**.
4. Back in Supabase: **Authentication → Providers → Google** → enable, paste the
   Client ID + secret, **Save**.

## 4. Allow your site to receive the login redirect

Supabase → **Authentication → URL Configuration**:

- **Site URL:** `https://7luk.github.io/open-rack-builder/`
- **Redirect URLs** — add both:
  - `https://7luk.github.io/open-rack-builder/`
  - `http://localhost:8000/` (or whatever you use for local testing over http)

(Google login needs `http(s)`; it will not work from a `file://` page — that's
expected, and the app keeps the feature off there.)

## 5. Wire the keys into the app

Supabase → **Project Settings → API**, copy:

- **Project URL**
- the **anon / public** key (NOT the `service_role` key)

Paste them into [`js/config.js`](../js/config.js):

```js
window.ORB_CONFIG = {
  supabaseUrl: "https://YOUR-PROJECT-REF.supabase.co",
  supabaseAnonKey: "eyJhbGciOi...the long anon key...",
};
```

These are **safe to commit** — the anon key is a public client key, and all
access is gated by the row-level-security policies from step 2.

Commit & push. Within a minute GitHub Pages redeploys and the **Community**
menu appears: guests browse the shared library; "Sign in with Google" unlocks
publishing.

---

## Quick local test

```sh
cd "open rack builder"
python3 -m http.server 8000
# open http://localhost:8000
```

Serving over `http://localhost` (not opening the file directly) is what lets
the OAuth redirect work locally.
