// ═══════════════════════════════════════════════════════════════
// cloud-bridge.js
// Phase 6 — connects the EXISTING dashboard UI to the cloud backend.
//
// Design choice: this file does NOT touch ptRefreshUI(), sptRefreshUI(),
// or any rendering code. Instead it populates PT_PORTFOLIO / SPT_PORTFOLIO
// — the exact same global objects those functions already read — with
// data fetched from Supabase, then calls the existing refresh functions.
// The UI itself is completely unmodified, exactly as the brief required.
//
// This file is additive: add one line to index.html to load it
// (see the comment at the very bottom), nothing else in index.html
// needs to change for this phase.
//
// Requires SUPA_URL and SUPA_KEY to already be defined earlier in the
// page (they are — index.html line ~23244) — this file reuses them
// rather than declaring a second config.
// ═══════════════════════════════════════════════════════════════

(function () {
  var SUPA_URL = 'https://kmrsqijzjixpmbgcjnxs.supabase.co'; var SUPA_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImttcnNxaWp6aml4cG1
  var POLL_MS = 20000; // dashboard refresh cadence — this is a read-only display poll against Supabase's REST API (cheap), not Angel One, so no rate-limit concern here.
  var pillEl = null;

  function ensureStatusPill() {
    if (pillEl) return pillEl;
    var hdrR = document.querySelector('.hdr-r');
    if (!hdrR) return null;
    pillEl = document.createElement('div');
    pillEl.className = 'pill';
    pillEl.id = 'cloudEnginePill';
    pillEl.innerHTML = '<div class="dot o"></div><span id="cloudEngineTxt">CLOUD ENGINE …</span>';
    hdrR.insertBefore(pillEl, hdrR.firstChild);
    return pillEl;
  }

  function setPill(status) {
    var el = ensureStatusPill();
    if (!el) return;
    var dot = el.querySelector('.dot');
    var txt = document.getElementById('cloudEngineTxt');
    var map = {
      ONLINE:   { cls: 'g', label: '🟢 CLOUD ENGINE ONLINE' },
      DEGRADED: { cls: 'o', label: '🟡 DEGRADED' },
      OFFLINE:  { cls: 'r', label: '🔴 OFFLINE' }
    };
    var cfg = map[status] || map.OFFLINE;
    if (dot) dot.className = 'dot ' + cfg.cls;
    if (txt) txt.textContent = cfg.label;
  }

  function supaGet(path) {
    return fetch(SUPA_URL + path, {
      headers: { 'apikey': SUPA_KEY, 'Authorization': 'Bearer ' + (window._SUPA_TOKEN || SUPA_KEY) }
    }).then(function (r) { return r.ok ? r.json() : []; }).catch(function () { return []; });
  }

  function fmtDateIST(iso) {
    if (!iso) return null;
    return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  }
  function fmtTimeIST(iso) {
    if (!iso) return null;
    return new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
  }
  function dayKeyIST(iso) {
    if (!iso) return null;
    return new Date(iso).toLocaleDateString('en-CA');
  }

  // Maps a cloud `paper_trades` row onto the exact shape ptRefreshUI/
  // sptRefreshUI already expect (see PT_PORTFOLIO.trades in index.html).
  function cloudTradeToLocal(row) {
    return {
      id: row.id, // note: this is now a UUID string, not a Date.now() number —
                  // manual edit/delete buttons are disabled on cloud-sourced
                  // trades (see cloudOwned flag below) specifically because
                  // those buttons assume they can freely mutate the local
                  // array; a cloud trade must only ever be changed by the
                  // backend, so the buttons are hidden rather than risking a
                  // local edit that silently diverges from Supabase.
              cloudOwned: true,
      instr: row.symbol,
      source: row.signal_id ? 'AUTO SIGNAL' : 'MANUAL',
      strategy: row.strategy,
      buy: row.entry_price,
      qty: row.qty,
      cost: row.entry_price * row.qty,
      target: row.target,
      sl: row.stop_loss,
      status: row.status === 'OPEN' ? 'OPEN' : (row.result || row.status),
      exit: row.exit_price,
      gross: row.gross_pnl,
      net: row.net_pnl,
      pnlPct: (row.exit_price && row.entry_price) ? ((row.exit_price - row.entry_price) / row.entry_price * 100).toFixed(2) : null,
      date: fmtDateIST(row.opened_at),
      dayKey: dayKeyIST(row.opened_at),
      time: fmtTimeIST(row.opened_at),
      exitDate: fmtDateIST(row.closed_at),
      exitTime: fmtTimeIST(row.closed_at)
    };
  }

  async function syncPaperTrades() {
    var rows = await supaGet('/rest/v1/paper_trades?portfolio=eq.options&order=opened_at.desc&limit=500');
    if (!Array.isArray(rows) || !rows.length) return;
    if (typeof PT_PORTFOLIO === 'undefined' || !window.PT_PORTFOLIO) {
      if (typeof ptInit === 'function') ptInit();
    }
    if (window.PT_PORTFOLIO) {
      window.PT_PORTFOLIO.trades = rows.map(cloudTradeToLocal);
      if (typeof ptRecalculateCash === 'function') ptRecalculateCash();
      if (typeof ptRefreshUI === 'function') ptRefreshUI();
    }
  }

  async function syncEngineStatus() {
    var rows = await supaGet('/rest/v1/engine_status?id=eq.1&select=*');
    var row = Array.isArray(rows) ? rows[0] : null;
    if (!row) { setPill('OFFLINE'); return; }

    // Treat a heartbeat older than 3 minutes as DEGRADED even if the
    // last-written status says ONLINE — a stalled process that stops
    // heartbeating but never got to write its own OFFLINE row should
    // still show as unhealthy on the dashboard.
    var staleMs = row.last_heartbeat ? (Date.now() - new Date(row.last_heartbeat).getTime()) : Infinity;
    if (staleMs > 3 * 60 * 1000) setPill('DEGRADED');
    else setPill(row.status || 'OFFLINE');
  }

  async function syncAll() {
    await Promise.all([syncPaperTrades(), syncEngineStatus()]);
  }

  function start() {
    setPill('OFFLINE'); // honest default until the first successful poll
    syncAll();
    setInterval(syncAll, POLL_MS);
  }

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(start, 500); // small delay so ptInit()/sptInit() have already run once locally
  } else {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(start, 500); });
  }
})();

// ═══════════════════════════════════════════════════════════════
// TO ACTIVATE: add this one line in index.html, right before </body>:
//   <script src="cloud-bridge.js"></script>
// That's the only change needed to index.html for this phase.
// ═══════════════════════════════════════════════════════════════
