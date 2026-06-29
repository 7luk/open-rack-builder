/* supabase.js — optional backend bootstrap.
 *
 * Loads the official supabase-js client LAZILY from a CDN, and only when
 *   (a) the page is served over http(s), and
 *   (b) config.js holds real credentials.
 * On file:// or when unconfigured, nothing is fetched — the base app stays
 * dependency-free and works offline exactly as before. This is the single
 * point where the (optional) network backend enters the app.
 */
window.SupabaseClient = (function () {
  "use strict";

  var SDK_URL = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2";
  var client = null;
  var ready = null; // memoised init() promise

  function cfg() {
    return window.ORB_CONFIG || {};
  }

  // is the backend usable in this context?
  function enabled() {
    var c = cfg();
    return (
      /^https?:$/.test(location.protocol) &&
      typeof c.supabaseUrl === "string" &&
      /^https:\/\/[a-z0-9-]+\.supabase\.co/i.test(c.supabaseUrl) &&
      typeof c.supabaseAnonKey === "string" &&
      c.supabaseAnonKey.length > 20
    );
  }

  // resolve to the live client, or null if disabled / the SDK failed to load.
  // memoised: safe to call repeatedly.
  function init() {
    if (ready) return ready;
    if (!enabled()) {
      ready = Promise.resolve(null);
      return ready;
    }
    ready = loadScript(SDK_URL)
      .then(function () {
        var c = cfg();
        client = window.supabase.createClient(c.supabaseUrl, c.supabaseAnonKey, {
          auth: {
            persistSession: true,
            autoRefreshToken: true,
            detectSessionInUrl: true, // parse the OAuth redirect hash on return
          },
        });
        return client;
      })
      .catch(function (e) {
        console.warn("Supabase failed to load — community features off.", e);
        client = null;
        return null;
      });
    return ready;
  }

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement("script");
      s.src = src;
      s.async = true;
      s.onload = function () {
        resolve();
      };
      s.onerror = function () {
        reject(new Error("load error: " + src));
      };
      document.head.appendChild(s);
    });
  }

  return {
    enabled: enabled,
    init: init,
    get client() {
      return client;
    },
  };
})();
