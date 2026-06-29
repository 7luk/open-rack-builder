/* config.js — public, committable configuration.
 *
 * These values are SAFE to commit. The Supabase "anon" key is a public
 * client key: all access is governed by row-level security policies on the
 * server (see supabase/schema.sql), NOT by keeping the key secret.
 *
 * Leave the two strings empty to keep the community features dormant — the
 * app then behaves exactly like the plain GitHub Pages build (built-in
 * devices + the static community-devices.json fallback, no sign-in).
 *
 * Fill them in (Supabase → Project Settings → API) to turn on the live
 * community library + Google sign-in. See supabase/SETUP.md.
 */
window.ORB_CONFIG = {
  supabaseUrl: "",     // e.g. "https://abcdefghijkl.supabase.co"
  supabaseAnonKey: "", // the "anon / public" project key
};
