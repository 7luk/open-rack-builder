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
  supabaseUrl: "https://lwsbsalmgjnrvkqlvidx.supabase.co",
  supabaseAnonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx3c2JzYWxtZ2pucnZrcWx2aWR4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI3NDA4NjAsImV4cCI6MjA5ODMxNjg2MH0.oDsH2PgAKYRhtVbx77kxm6a0n8vmawMMw7DS0wIz7Ww", // the "anon / public" project key — paste it here
};
