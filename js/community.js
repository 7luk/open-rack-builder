/* community.js — the shared device library + Google sign-in, backed by
 * Supabase. Active only when SupabaseClient.enabled() is true (the hosted
 * site, with credentials configured). Otherwise the whole feature stays
 * dormant: the Community menu is hidden and the app falls back to the
 * static community-devices.json — identical to today's behaviour.
 *
 * Devices are METADATA ONLY (name, brand, U, colour, depth, rear ports) —
 * never images — so no third-party faceplate artwork is ever published.
 *
 * Guests can browse everything. Posting requires a Google sign-in; the
 * server's row-level security (supabase/schema.sql) is what actually
 * enforces "anyone reads, only signed-in users write their own rows".
 */
window.Community = (function () {
  "use strict";

  var sb = null; // the supabase client, once loaded
  var session = null; // current auth session, or null for a guest
  var refs = {}; // menu nodes we keep in sync with sign-in state

  /* ---------- lifecycle ---------- */
  function init() {
    refs.menu = document.getElementById("community-menu");
    refs.status = document.getElementById("community-status");
    refs.auth = byAction("community-auth");
    refs.publish = byAction("community-publish");

    // dormant on file:// or when unconfigured — hide the menu, bail out.
    if (!SupabaseClient.enabled()) {
      if (refs.menu) refs.menu.hidden = true;
      return;
    }

    SupabaseClient.init().then(function (client) {
      if (!client) {
        if (refs.menu) refs.menu.hidden = true;
        return;
      }
      sb = client;

      // react to sign-in / sign-out / token refresh / redirect-restore
      sb.auth.onAuthStateChange(function (_event, s) {
        session = s;
        updateAuthUI();
      });
      sb.auth.getSession().then(function (res) {
        session = res && res.data ? res.data.session : null;
        updateAuthUI();
      });

      loadDevices();
    });
  }

  /* ---------- the device registry ---------- */
  function loadDevices() {
    if (!sb) return;
    sb.from("devices")
      .select("name,brand,cat,u,color,depth,rear_label,author_name")
      .order("created_at", { ascending: false })
      .then(function (res) {
        if (res.error) {
          console.warn("community load failed", res.error);
          return;
        }
        var list = (res.data || []).map(function (row) {
          return {
            cat: row.cat || "Community",
            name: row.name,
            brand: row.brand || "",
            u: row.u,
            color: row.color,
            depth: row.depth,
            rearLabel: row.rear_label || "",
          };
        });
        Library.setCommunity(list);
        App.refreshLibrary();
      });
  }

  /* ---------- publishing ---------- */
  function publish(device) {
    if (!sb) return;
    if (!session) {
      App.flash("Sign in with Google to publish");
      signIn();
      return;
    }
    var u = user();
    var row = {
      name: device.name || "Device",
      brand: device.brand || "",
      cat: device.cat || "Community",
      u: clampInt(device.u, 1, 12, 1),
      color: device.color || "#2a2a2e",
      depth: clampInt(device.depth, 20, 2000, 250),
      rear_label: device.rearLabel || "",
      author_name: u ? u.name : null,
    };
    sb.from("devices")
      .insert(row)
      .then(function (res) {
        if (res.error) {
          console.warn("publish failed", res.error);
          App.flash("Publish failed — try again");
          return;
        }
        App.flash("Published to the community library");
        loadDevices();
      });
  }

  /* ---------- auth ---------- */
  function signIn() {
    if (!sb) return;
    sb.auth.signInWithOAuth({
      provider: "google",
      // come back to this exact page (minus any leftover OAuth hash)
      options: { redirectTo: location.href.split("#")[0] },
    });
  }
  function signOut() {
    if (!sb) return;
    sb.auth.signOut().then(function () {
      session = null;
      updateAuthUI();
      App.flash("Signed out");
    });
  }
  function toggleAuth() {
    if (session) signOut();
    else signIn();
  }

  function user() {
    if (!session || !session.user) return null;
    var u = session.user;
    var m = u.user_metadata || {};
    return {
      id: u.id,
      email: u.email || "",
      name: m.full_name || m.name || u.email || "Account",
    };
  }

  function updateAuthUI() {
    var u = user();
    if (refs.auth) refs.auth.textContent = u ? "Sign out" : "Sign in with Google";
    if (refs.status) {
      refs.status.textContent = u ? "Signed in as " + u.name : "Browsing as a guest";
    }
    if (refs.menu) refs.menu.classList.toggle("signed-in", !!u);
  }

  /* ---------- helpers ---------- */
  function byAction(name) {
    return document.querySelector('[data-action="' + name + '"]');
  }
  function clampInt(v, lo, hi, dflt) {
    var n = parseInt(v, 10);
    if (!isFinite(n)) n = dflt;
    return Math.max(lo, Math.min(hi, n));
  }

  return {
    init: init,
    enabled: function () {
      return SupabaseClient.enabled();
    },
    refresh: loadDevices,
    publish: publish,
    toggleAuth: toggleAuth,
    signedIn: function () {
      return !!session;
    },
  };
})();
