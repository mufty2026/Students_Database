// Cloud sync layer.
//
// The app keeps reading and writing its local copy (Store / localStorage)
// exactly as before. This file:
//   * shows a sign-in screen when Firebase is configured,
//   * pushes every local change to the shared database (per record),
//   * applies other devices' changes to the local copy as they happen,
//   * on a device's first connection, asks what to do with data that only
//     exists on that device (upload it / merge it / discard it).
//
// If js/firebase-config.js still has the placeholder values, none of this
// runs and the app stays local-only.

const Sync = (function () {
  "use strict";

  const COLS = ["students", "houses", "programs", "settings"];
  const MIGRATED_KEY = "tracer.cloud.migrated.v1";
  const BACKUP_KEY = "tracer.precloud.backup.v1";
  const SETTINGS_ID = "main";
  const FLUSH_DELAY = { students: 30, houses: 30, programs: 30, settings: 400 };

  const $ = (id) => document.getElementById(id);
  const hooks = { onRemoteChange() {}, toast() {} };

  let adapter = null, user = null, unsubs = [], started = false;
  let cloud = {}, serverSeen = {}, anySeen = {}, pending = {}, lastSynced = {}, flushTimers = {};
  let decided = false, deciding = false, seedChecked = false, errorMsg = "", slowTimer = null;

  // ---------------------------------------------------------------- helpers
  function configured() {
    const c = window.FIREBASE_CONFIG;
    return !!(c && c.apiKey && !/^PASTE/i.test(c.apiKey));
  }

  // JSON with sorted keys, so two objects with the same content compare equal
  function stable(v) {
    if (Array.isArray(v)) return "[" + v.map(stable).join(",") + "]";
    if (v && typeof v === "object") {
      return "{" + Object.keys(v).sort().filter(k => v[k] !== undefined)
        .map(k => JSON.stringify(k) + ":" + stable(v[k])).join(",") + "}";
    }
    return JSON.stringify(v);
  }
  function toMap(list) {
    const m = {};
    list.forEach(item => { m[item.id] = stable(item); });
    return m;
  }
  function sameSet(a, b) {
    const ma = toMap(a), mb = toMap(b);
    const ka = Object.keys(ma);
    if (ka.length !== Object.keys(mb).length) return false;
    return ka.every(k => ma[k] === mb[k]);
  }
  function clean(item) { return JSON.parse(JSON.stringify(item)); }

  function getLocal(col) {
    if (col === "students") return Store.getStudents();
    if (col === "houses") return Store.getHouses();
    if (col === "programs") return Store.getPrograms();
    return [{ id: SETTINGS_ID, ...Store.getSettings() }];
  }

  function sortList(col, list) {
    if (col === "houses" || col === "programs") {
      list.sort((a, b) => ((a.ord ?? 0) - (b.ord ?? 0)) || String(a.name).localeCompare(String(b.name)));
    } else if (col === "students") {
      list.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    }
    return list;
  }

  function programsCustomised(programs) {
    const defaults = new Set(DEFAULT_PROGRAMS.map(n => n.toLowerCase()));
    if (programs.length !== defaults.size) return true;
    return programs.some(p => !defaults.has(String(p.name).toLowerCase()));
  }

  // ----------------------------------------------------------- UI: sign-in
  function showAuthLoading(text) {
    $("authScreen").hidden = false;
    $("authLoading").hidden = false;
    $("authLoadingText").textContent = text || "Loading…";
    $("authForm").hidden = true;
  }
  function showAuthForm(message) {
    $("authScreen").hidden = false;
    $("authLoading").hidden = true;
    $("authForm").hidden = false;
    $("authSubmit").disabled = false;
    $("authSubmit").textContent = "Sign in";
    setAuthError(message || "");
  }
  function hideAuth() { $("authScreen").hidden = true; }
  function setAuthError(msg) {
    $("authError").textContent = msg;
    $("authError").hidden = !msg;
  }

  function friendlyAuthError(err) {
    const code = (err && err.code) || "";
    if (/invalid-credential|wrong-password|user-not-found|invalid-email/.test(code)) return "Wrong email or password.";
    if (/too-many-requests/.test(code)) return "Too many attempts. Wait a few minutes and try again.";
    if (/network-request-failed/.test(code)) return "No internet connection. Connect and try again.";
    if (/user-disabled/.test(code)) return "This account has been disabled.";
    return "Couldn't sign in. Please try again.";
  }

  // ------------------------------------------------------- UI: status bar
  function renderStatus() {
    const bar = $("syncBar");
    if (!user) { bar.hidden = true; return; }
    bar.hidden = false;
    let cls = "ok", text = "All changes saved";
    if (errorMsg) { cls = "err"; text = errorMsg; }
    else if (!decided) { cls = "busy"; text = "Connecting…"; }
    else if (!navigator.onLine) { cls = "off"; text = "Offline — changes will sync when you reconnect"; }
    else if (COLS.some(c => pending[c])) { cls = "busy"; text = "Saving…"; }
    $("syncDot").className = "sync-dot sync-" + cls;
    $("syncText").textContent = text;
    $("syncUser").textContent = user.email || "";
  }

  // --------------------------------------------- UI: "what to do?" dialog
  function choose(title, body, labelA, labelB) {
    return new Promise(resolve => {
      $("syncChoiceTitle").textContent = title;
      $("syncChoiceBody").textContent = body;
      $("syncChoiceA").textContent = labelA;
      $("syncChoiceB").textContent = labelB;
      $("syncChoiceBackdrop").hidden = false;
      const done = (v) => { $("syncChoiceBackdrop").hidden = true; resolve(v); };
      $("syncChoiceA").onclick = () => done("a");
      $("syncChoiceB").onclick = () => done("b");
    });
  }

  // ----------------------------------------------------- local -> cloud
  function onLocalWrite(col) {
    if (!decided) return;
    clearTimeout(flushTimers[col]);
    flushTimers[col] = setTimeout(() => flush(col), FLUSH_DELAY[col] || 30);
  }

  function flush(col) {
    clearTimeout(flushTimers[col]);
    delete flushTimers[col];
    if (!adapter || !user || !decided) return;

    const list = getLocal(col);
    const prev = lastSynced[col] || {};
    const next = toMap(list);
    const upserts = [], deletes = [];
    list.forEach(item => { if (prev[item.id] !== next[item.id]) upserts.push(clean(item)); });
    if (col !== "settings") Object.keys(prev).forEach(id => { if (!(id in next)) deletes.push(id); });
    lastSynced[col] = next;
    if (!upserts.length && !deletes.length) return;

    Promise.resolve(adapter.write(col, upserts, deletes)).catch(err => {
      console.error("Cloud write failed", col, err);
      errorMsg = /permission/i.test(String(err && (err.code || err.message)))
        ? "Your changes were not saved: this account doesn't have access."
        : "Some changes could not be saved. Check your connection.";
      renderStatus();
    });
    renderStatus();
  }

  // ----------------------------------------------------- cloud -> local
  let renderTimer = null;
  function scheduleRemoteRender() {
    clearTimeout(renderTimer);
    renderTimer = setTimeout(() => hooks.onRemoteChange(), 60);
  }

  function applyToLocal(col, list) {
    lastSynced[col] = toMap(list);
    if (sameSet(getLocal(col), list)) return false;
    Store.applyRemote(col, list);
    return true;
  }

  function onSnap(col, snap) {
    const list = sortList(col, snap.docs.map(d => ({ ...d.data, id: d.id })));
    cloud[col] = list;
    pending[col] = !!snap.pending;
    anySeen[col] = true;
    if (!snap.fromCache) serverSeen[col] = true;
    errorMsg = "";

    if (decided) {
      // If we have a local change waiting to be sent, don't overwrite it;
      // the next snapshot (which includes our change) will reconcile.
      if (!flushTimers[col]) {
        const changed = (col === "settings" && !list.length) ? false : applyToLocal(col, list);
        if (changed) scheduleRemoteRender();
      }
      maybeSeed();
    } else if (!deciding) {
      // First time on this device we must hear from the server (a cached
      // snapshot could be empty/stale). A device that has already been set
      // up can start from its offline cache.
      // While online, an *empty* cached snapshot isn't trusted (it could just
      // mean the cache hasn't filled yet); only offline do we accept it.
      const flagged = !!localStorage.getItem(MIGRATED_KEY);
      const ready = (c) => serverSeen[c] ||
        (flagged && anySeen[c] && (!navigator.onLine || (cloud[c] && cloud[c].length > 0)));
      if (COLS.every(ready)) decide();
    }
    renderStatus();
  }

  function onSubError(col, err) {
    console.error("Cloud read failed", col, err);
    errorMsg = /permission/i.test(String(err && (err.code || err.message)))
      ? "No access to the shared data. Ask your administrator to add your email."
      : "Sync problem. Check your connection.";
    renderStatus();
  }

  // ------------------------------------- first connection on this device
  function adoptCloud() {
    COLS.forEach(col => {
      if (col === "settings" && !cloud.settings.length) { lastSynced.settings = {}; return; }
      applyToLocal(col, cloud[col]);
    });
    decided = true;
  }

  function uploadLocal() {
    // give houses/programmes a stable order, mark defaults as already created
    const withOrd = (list) => list.map((x, i) => (x.ord === undefined ? { ...x, ord: i } : x));
    Store.applyRemote("houses", withOrd(Store.getHouses()));
    Store.applyRemote("programs", withOrd(Store.getPrograms()));
    Store.applyRemote("settings", [{ id: SETTINGS_ID, ...Store.getSettings(), programsSeeded: true }]);
    COLS.forEach(col => { lastSynced[col] = {}; });
    decided = true;
    seedChecked = true;       // programmes came from this device; never add the defaults on top
    COLS.forEach(flush);
  }

  function mergeLocal(local) {
    const norm = (s) => String(s || "").trim().toLowerCase();
    const houses = cloud.houses.map(h => ({ ...h }));
    const programs = cloud.programs.map(p => ({ ...p }));
    const hMap = {}, pMap = {};
    local.houses.forEach(lh => {
      const ch = houses.find(h => norm(h.name) === norm(lh.name));
      if (ch) hMap[lh.id] = ch.id;
      else { houses.push({ ...lh, ord: lh.ord ?? Date.now() }); hMap[lh.id] = lh.id; }
    });
    local.programs.forEach((lp, i) => {
      const cp = programs.find(p => norm(p.name) === norm(lp.name));
      if (cp) pMap[lp.id] = cp.id;
      else { programs.push({ ...lp, ord: lp.ord ?? i }); pMap[lp.id] = lp.id; }
    });

    const students = cloud.students.map(s => ({ ...s }));
    let added = 0, skipped = 0;
    local.students.forEach(ls => {
      const s = { ...ls, houseId: ls.houseId ? (hMap[ls.houseId] || "") : "", programId: ls.programId ? (pMap[ls.programId] || "") : "" };
      if (Store.matchStudent(s, students, null)) skipped++;
      else { students.push(s); added++; }
    });

    Store.applyRemote("houses", sortList("houses", houses));
    Store.applyRemote("programs", sortList("programs", programs));
    Store.applyRemote("students", sortList("students", students));
    if (cloud.settings.length) Store.applyRemote("settings", cloud.settings);
    else Store.applyRemote("settings", [{ id: SETTINGS_ID, ...Store.getSettings(), programsSeeded: true }]);

    // "already synced" = what the cloud had, so only the additions get sent
    COLS.forEach(col => { lastSynced[col] = toMap(cloud[col]); });
    decided = true;
    seedChecked = true;
    COLS.forEach(flush);
    return { added, skipped };
  }

  // Create the default programme list once, and only when the *server* has
  // confirmed the shared database really has no programmes yet.
  function maybeSeed() {
    if (seedChecked || !decided || !COLS.every(c => serverSeen[c])) return;
    seedChecked = true;
    const settingsDoc = cloud.settings.find(x => x.id === SETTINGS_ID);
    const seeded = !!(settingsDoc && settingsDoc.programsSeeded) || !!Store.getSettings().programsSeeded;
    if (!seeded && cloud.programs.length === 0) {
      Store.setPrograms(Store.defaultPrograms());
      Store.setSettings({ ...Store.getSettings(), programsSeeded: true });
    }
  }

  async function decide() {
    deciding = true;
    const first = !localStorage.getItem(MIGRATED_KEY);
    const local = { students: Store.getStudents(), houses: Store.getHouses(), programs: Store.getPrograms() };
    const cloudHasData = cloud.students.length > 0 || cloud.houses.length > 0;
    const localHasData = local.students.length > 0 || local.houses.length > 0 || programsCustomised(local.programs);

    if (first && localHasData) {
      // safety net: keep a copy of what was on this device before the cloud touched it
      try { localStorage.setItem(BACKUP_KEY, JSON.stringify({ at: Date.now(), ...local, settings: Store.getSettings() })); } catch (e) {}
    }

    const n = (x, w) => `${x} ${w}${x === 1 ? "" : "s"}`;
    if (!first || !localHasData) {
      adoptCloud();
    } else if (!cloudHasData) {
      const pick = await choose(
        "Upload this device's data?",
        `This device has ${n(local.students.length, "student")}, ${n(local.houses.length, "house")} and ${n(local.programs.length, "programme")} saved on it. ` +
        `Upload them so every signed-in device shares the same list.`,
        "Upload to shared database", "Start fresh (discard this device's copy)");
      if (pick === "a") uploadLocal(); else adoptCloud();
    } else {
      const pick = await choose(
        "Combine with the shared data?",
        `The shared database already has ${n(cloud.students.length, "student")}. ` +
        `This device also has ${n(local.students.length, "student")} saved only on it. ` +
        `Add yours to the shared list (anyone already there is skipped), or use the shared data only?`,
        "Add mine (skip duplicates)", "Use shared data only");
      if (pick === "a") {
        const r = mergeLocal(local);
        hooks.toast(`Added ${n(r.added, "student")} from this device${r.skipped ? `; ${r.skipped} already in the shared list` : ""}`);
      } else adoptCloud();
    }

    try { localStorage.setItem(MIGRATED_KEY, "1"); } catch (e) {}
    decided = true;
    deciding = false;
    clearTimeout(slowTimer);
    hideAuth();
    maybeSeed();
    hooks.onRemoteChange();
    renderStatus();
  }

  // ------------------------------------------------------ session control
  function subscribeAll() {
    unsubs = COLS.map(col =>
      adapter.subscribe(col, snap => onSnap(col, snap), err => onSubError(col, err)));
    Store.onWrite = onLocalWrite;
  }

  function teardown() {
    unsubs.forEach(u => { try { u && u(); } catch (e) {} });
    unsubs = [];
    Object.values(flushTimers).forEach(clearTimeout);
    cloud = {}; serverSeen = {}; anySeen = {}; pending = {}; lastSynced = {}; flushTimers = {};
    decided = false; deciding = false; seedChecked = false; errorMsg = ""; user = null;
    clearTimeout(slowTimer);
    Store.onWrite = null;
    renderStatus();
  }

  function onAuth(u) {
    if (u) {
      if (user && user.uid === u.uid) return;
      user = u;
      showAuthLoading("Loading your data…");
      slowTimer = setTimeout(() => {
        if (!decided) $("authLoadingText").textContent = "Still connecting… check your internet connection.";
      }, 15000);
      renderStatus();
      const note = $("offlineText");
      if (note) note.textContent = "Shared database — syncs across devices";
      subscribeAll();
    } else {
      teardown();
      showAuthForm();
    }
  }

  function begin() {
    if (started) return;
    started = true;
    adapter = window.CloudAdapter;
    if (!adapter) {
      showAuthForm("Couldn't reach the sign-in service. Check your internet connection and reload the page.");
      $("authSubmit").disabled = true;
      return;
    }
    adapter.onAuth(onAuth);
  }

  function init(options) {
    Object.assign(hooks, options || {});
    if (!configured()) return;          // local-only mode

    showAuthLoading("Loading…");

    $("authForm").addEventListener("submit", (e) => {
      e.preventDefault();
      if (!adapter) return;
      setAuthError("");
      $("authSubmit").disabled = true;
      $("authSubmit").textContent = "Signing in…";
      adapter.signIn($("authEmail").value.trim(), $("authPassword").value)
        .then(() => { $("authPassword").value = ""; })
        .catch(err => { showAuthForm(friendlyAuthError(err)); });
    });
    $("btnSignOut").addEventListener("click", () => { if (adapter) adapter.signOut(); });
    window.addEventListener("online", renderStatus);
    window.addEventListener("offline", renderStatus);

    if (window.CloudAdapter) begin();
    else {
      document.addEventListener("cloudadapter-ready", begin, { once: true });
      setTimeout(() => { if (!started) begin(); }, 12000);
    }
  }

  return { init, configured, _debug: () => ({ decided, user, cloud }) };
})();
