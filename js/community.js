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
  var catalog = []; // last-fetched community devices (for the browse window)
  var overlay = null; // the open browse modal, or null

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
      if (refs.menu) refs.menu.hidden = false; // backend live → reveal the menu

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

  /* ---------- the device registry ----------
     Fetched into `catalog` for the Browse window. Unlike the static fallback,
     community devices are NOT auto-dumped into the sidebar — the user picks
     which ones to import (they then live in their library with a flag). */
  function loadDevices() {
    if (!sb) return Promise.resolve([]);
    return queryDevices(true)
      .then(function (res) {
        // tolerate the `dev` column not existing yet (older schema)
        return res.error ? queryDevices(false) : res;
      })
      .then(function (res) {
        if (res.error) {
          console.warn("community load failed", res.error);
          return [];
        }
        catalog = (res.data || []).map(function (row) {
          return {
            id: row.id,
            cat: row.cat || "Community",
            name: row.name,
            brand: row.brand || "",
            u: row.u,
            color: row.color,
            depth: row.depth,
            rearLabel: row.rear_label || "",
            author: row.author_name || "",
            fromDev: !!row.dev,
          };
        });
        if (overlay) renderCards(); // refresh an open window
        return catalog;
      });
  }
  function queryDevices(withDev) {
    var cols = "id,name,brand,cat,u,color,depth,rear_label,author_name";
    if (withDev) cols += ",dev";
    return sb.from("devices").select(cols).order("created_at", { ascending: false });
  }
  function refresh() {
    return loadDevices();
  }

  /* ---------- the browse window ----------
     A large (80vw/80vh) modal over a blurred backdrop. Pick devices, import
     them into your library; already-imported ones are shown as such. */
  var grid, footBtn, searchInput, query, selected;

  function openBrowser() {
    if (overlay) return;
    selected = {};
    query = "";

    overlay = ce("div", "community-overlay");
    var modal = ce("div", "community-modal");

    // header: title + search + close
    var head = ce("div", "cmodal-head");
    head.appendChild(ce("h2", "cmodal-title", "Community library"));
    searchInput = document.createElement("input");
    searchInput.type = "search";
    searchInput.className = "cmodal-search";
    searchInput.placeholder = "Search community devices";
    searchInput.addEventListener("input", function () {
      query = searchInput.value;
      renderCards();
    });
    head.appendChild(searchInput);
    var close = ce("button", "cmodal-close", "✕");
    close.title = "Close";
    close.addEventListener("click", closeBrowser);
    head.appendChild(close);
    modal.appendChild(head);

    // body: the card grid
    var body = ce("div", "cmodal-body");
    grid = ce("div", "cdev-grid");
    body.appendChild(grid);
    modal.appendChild(body);

    // footer: status + import action
    var foot = ce("div", "cmodal-foot");
    var hint = ce("div", "cmodal-hint", session ? "" : "Sign in to publish your own devices.");
    foot.appendChild(hint);
    footBtn = ce("button", "btn btn-primary", "Import selected");
    footBtn.disabled = true;
    footBtn.addEventListener("click", importSelected);
    foot.appendChild(footBtn);
    modal.appendChild(foot);

    overlay.appendChild(modal);
    // click the dimmed backdrop (outside the panel) to dismiss
    overlay.addEventListener("mousedown", function (e) {
      if (e.target === overlay) closeBrowser();
    });
    document.body.appendChild(overlay);
    document.addEventListener("keydown", onOverlayKey, true);

    renderCards();
    loadDevices(); // always grab the freshest list when opening
    setTimeout(function () {
      searchInput.focus();
    }, 0);
  }

  function closeBrowser() {
    if (!overlay) return;
    document.removeEventListener("keydown", onOverlayKey, true);
    overlay.remove();
    overlay = null;
    grid = footBtn = searchInput = null;
  }

  // keep app shortcuts from firing while the window is open; Escape closes it
  function onOverlayKey(e) {
    if (!overlay) return;
    if (e.key === "Escape") {
      e.stopPropagation();
      closeBrowser();
      return;
    }
    var t = e.target;
    var typing = t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA");
    if (!typing) e.stopPropagation();
  }

  function renderCards() {
    if (!grid) return;
    grid.innerHTML = "";
    var q = (query || "").trim().toLowerCase();
    var list = catalog.filter(function (d) {
      if (!q) return true;
      return (
        (d.name || "").toLowerCase().indexOf(q) >= 0 ||
        (d.brand || "").toLowerCase().indexOf(q) >= 0 ||
        (d.cat || "").toLowerCase().indexOf(q) >= 0
      );
    });

    if (!list.length) {
      grid.appendChild(
        ce(
          "div",
          "cdev-empty",
          catalog.length
            ? "No community devices match your search."
            : "No community devices yet — be the first to publish one!"
        )
      );
      updateFootBtn();
      return;
    }
    list.forEach(function (d) {
      grid.appendChild(cardEl(d));
    });
    updateFootBtn();
  }

  function cardEl(d) {
    var imported = isImported(d);
    var card = ce("div", "cdev-card" + (imported ? " imported" : ""));
    if (selected[d.id]) card.classList.add("selected");

    var bar = ce("div", "cdev-color");
    bar.style.background = d.color || "#2a2a2e";
    card.appendChild(bar);

    var info = ce("div", "cdev-info");
    info.appendChild(ce("div", "cdev-name", d.name));
    info.appendChild(ce("div", "cdev-brand", d.brand || "—"));
    info.appendChild(ce("div", "cdev-spec", d.u + "U · " + (d.cat || "Community")));

    var by = ce("div", "cdev-by");
    by.appendChild(document.createTextNode(d.author ? "by " + d.author : "by anonymous"));
    if (d.fromDev) {
      var badge = ce("span", "lib-flag dev", "DEV");
      by.appendChild(badge);
    }
    info.appendChild(by);
    card.appendChild(info);

    var tick = ce("div", "cdev-tick", imported ? "✓ Imported" : "");
    card.appendChild(tick);

    if (!imported) {
      card.addEventListener("click", function () {
        if (selected[d.id]) delete selected[d.id];
        else selected[d.id] = true;
        card.classList.toggle("selected", !!selected[d.id]);
        updateFootBtn();
      });
    }
    return card;
  }

  function updateFootBtn() {
    if (!footBtn) return;
    var n = Object.keys(selected).length;
    footBtn.disabled = n === 0;
    footBtn.textContent = n ? "Import selected (" + n + ")" : "Import selected";
  }

  function importSelected() {
    var ids = Object.keys(selected);
    if (!ids.length) return;
    var added = 0;
    ids.forEach(function (id) {
      var d = catalog.filter(function (x) {
        return String(x.id) === String(id);
      })[0];
      if (d && State.importCommunityDevice(d)) added++;
    });
    selected = {};
    renderCards(); // imported ones flip to the "Imported" state
    App.flash(
      added ? "Imported " + added + " device" + (added > 1 ? "s" : "") : "Already in your library"
    );
  }

  function isImported(d) {
    var key = ((d.brand || "") + " " + (d.name || "")).trim().toLowerCase();
    return State.get().customLibrary.some(function (c) {
      return ((c.brand || "") + " " + (c.name || "")).trim().toLowerCase() === key;
    });
  }

  /* ---------- publishing ----------
     A device is identified by its normalised brand + name. No two community
     devices may share that identity, so the same gear can't be published
     twice and one user can't re-publish (copy) another's work. This is
     enforced for real by a UNIQUE index in the database (schema.sql); the
     client check below is just for an instant, friendly message. */
  function publish(device) {
    if (!sb) return;
    if (!session) {
      App.flash("Sign in with Google to publish");
      signIn();
      return;
    }
    var u = user();
    var slug = normSlug(device.brand, device.name);
    var label = "“" + (device.name || "That device") + "”";
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

    // refresh first so the duplicate check sees the live list, then guard
    loadDevices().then(function () {
      var clash = catalog.filter(function (c) {
        return normSlug(c.brand, c.name) === slug;
      })[0];
      if (clash) {
        App.flash(
          clash.author && u && clash.author === u.name
            ? "You already published " + label
            : label + " is already in the community library"
        );
        return;
      }
      sb.from("devices")
        .insert(row)
        .then(function (res) {
          if (res.error) {
            // 23505 = unique violation: someone published it first
            if (res.error.code === "23505") {
              App.flash(label + " is already in the community library");
            } else {
              console.warn("publish failed", res.error);
              App.flash("Publish failed — try again");
            }
            return;
          }
          App.flash("Published to the community library");
          loadDevices();
        });
    });
  }

  // normalised device identity: brand + name, collapsed/trimmed/lowercased.
  // MUST match the expression behind the DB unique index in schema.sql.
  function normSlug(brand, name) {
    return ((brand || "") + " " + (name || "")).replace(/\s+/g, " ").trim().toLowerCase();
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
  function ce(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
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
    refresh: refresh,
    openBrowser: openBrowser,
    publish: publish,
    toggleAuth: toggleAuth,
    signedIn: function () {
      return !!session;
    },
  };
})();
