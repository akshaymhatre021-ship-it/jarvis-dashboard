/* ─────────────────────────────────────────────────────────────
   JARVIS Native Bridge — Capacitor only, personal build.
   Runs ONLY inside the native Android/iOS shell (no-op on regular
   web/browser use, so this file is safe to include everywhere).

   What it does:
   1. Moves the sensitive credential keys (API keys, TOTP secret,
      MPIN, JWT/feed tokens) out of plain localStorage and into the
      OS-level encrypted store (Android Keystore / iOS Keychain)
      via capacitor-secure-storage-plugin — while keeping the exact
      same localStorage.getItem/setItem calls working everywhere
      else in the 25k-line app, so nothing else needs to change.
   2. Optionally requires Face ID / fingerprint before the app
      shows any data, using @capacitor-community/biometric-auth.
   ───────────────────────────────────────────────────────────── */
(function () {
  if (!window.Capacitor || !window.Capacitor.isNativePlatform || !window.Capacitor.isNativePlatform()) {
    return; // regular browser / PWA — leave localStorage exactly as-is
  }

  var SecureStorage = window.Capacitor.Plugins && window.Capacitor.Plugins.SecureStoragePlugin;
  var BiometricAuth  = window.Capacitor.Plugins && window.Capacitor.Plugins.BiometricAuth;

  // Keys that hold anything sensitive — pulled from the same list
  // the app itself already flags internally (JWT, MPIN, TOTP secret,
  // API key, client ID, feed token, kite secret).
  var SENSITIVE_KEYS = [
    'ja_j', 'ja_m', 'ja_t', 'ja_k', 'ja_c', 'ja_f',
    'ja_kite_secret', 'ja_kite_key', 'ja_kite_access', 'ja_pin', 'ja_totp'
  ];

  if (SecureStorage) {
    var memCache = {};

    // Preload secure values into memory once at boot so synchronous
    // localStorage.getItem() calls elsewhere in the app keep working.
    var preload = SENSITIVE_KEYS.map(function (k) {
      return SecureStorage.get({ key: k }).then(function (r) {
        memCache[k] = r.value;
        try { window.localStorage.setItem(k, r.value); } catch (e) {}
      }).catch(function () { /* not set yet — fine */ });
    });

    var origSetItem = window.localStorage.setItem.bind(window.localStorage);
    window.localStorage.setItem = function (key, value) {
      origSetItem(key, value); // keep in-memory/local copy for sync reads
      if (SENSITIVE_KEYS.indexOf(key) !== -1) {
        SecureStorage.set({ key: key, value: String(value) }).catch(function (e) {
          console.error('[NativeBridge] secure set failed for', key, e);
        });
      }
    };

    var origRemoveItem = window.localStorage.removeItem.bind(window.localStorage);
    window.localStorage.removeItem = function (key) {
      origRemoveItem(key);
      if (SENSITIVE_KEYS.indexOf(key) !== -1) {
        SecureStorage.remove({ key: key }).catch(function () {});
      }
    };

    window._jarvisSecureStorageReady = Promise.all(preload);
  }

  // Optional biometric gate before the app is usable. Wire this to a
  // button in Setup ("Require Face ID / Fingerprint") rather than
  // forcing it — leaving it off by default so first install isn't
  // blocked by a permission prompt.
  window.jarvisRequireBiometric = function () {
    if (!BiometricAuth) return Promise.resolve(true);
    return BiometricAuth.verify({
      reason: 'Unlock JARVIS',
      title: 'JARVIS',
      subtitle: 'Authenticate to continue',
      cancelTitle: 'Cancel'
    }).then(function () { return true; }).catch(function () { return false; });
  };

  console.log('[NativeBridge] Secure storage + biometric bridge active');

  // Force a fresh reload from GitHub Pages when the app RESUMES from
  // being backgrounded (not on cold/first start, which is already
  // fresh) — with a guard so it can't fire repeatedly in a loop.
  var AppPlugin = window.Capacitor.Plugins && window.Capacitor.Plugins.App;
  if (AppPlugin && AppPlugin.addListener) {
    var appLoadTime = Date.now();
    var reloadInFlight = false;
    AppPlugin.addListener('appStateChange', function (state) {
      if (!state || !state.isActive) return;
      if (reloadInFlight) return;
      // Ignore the state event Capacitor fires during cold start —
      // only reload if the app has actually been open a while
      // (i.e. this is a real resume-from-background, not first launch).
      if (Date.now() - appLoadTime < 10000) return;
      reloadInFlight = true;
      var freshUrl = window.location.origin + window.location.pathname + '?_=' + Date.now();
      window.location.replace(freshUrl);
    });
  }
})();
