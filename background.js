// background.js — service worker

const ZOTERO_BASE = "https://api.zotero.org";
const S2_PUBLIC   = "https://api.semanticscholar.org/graph/v1";

const PAPER_TYPES = new Set([
  "journalArticle", "conferencePaper", "preprint",
  "report", "thesis", "bookSection", "book",
]);

// ─────────────────────────────────────────────────────────────────────────────
// S2 tab communication
// ─────────────────────────────────────────────────────────────────────────────

const ANALYTICS_COOKIE = /^(_ga|_gid|_gat|amp_|ajs_|anon_|intercom)/;
let s2TabCache = null;

function sendMessage(tabId, msg) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, msg, r => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else if (r?.error)            reject(new Error(r.error));
      else                          resolve(r);
    });
  });
}

function isUnreachable(err) {
  const m = err.message ?? "";
  return m.includes("Receiving end does not exist") || m.includes("Could not establish");
}

async function waitForTabLoad(tabId) {
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab) throw new Error("Tab not found");
  if (tab.status === "complete") return;
  await new Promise((resolve, reject) => {
    const tid = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(fn);
      reject(new Error("S2 tab load timeout"));
    }, 30000);
    function fn(id, info) {
      if (id === tabId && info.status === "complete") {
        clearTimeout(tid);
        chrome.tabs.onUpdated.removeListener(fn);
        resolve();
      }
    }
    chrome.tabs.onUpdated.addListener(fn);
  });
}

async function pingTab(tabId) {
  try {
    const r = await sendMessage(tabId, { type: "PING" });
    return r?.pong === true;
  } catch {
    return false;
  }
}

async function getReachableS2TabId() {
  if (s2TabCache !== null) {
    if (await pingTab(s2TabCache)) return s2TabCache;
    s2TabCache = null;
  }
  const tabs = await chrome.tabs.query({ url: "https://www.semanticscholar.org/*" });
  for (const tab of tabs) {
    if (await pingTab(tab.id)) { s2TabCache = tab.id; return tab.id; }
  }
  const newTab = await chrome.tabs.create({ url: "https://www.semanticscholar.org/", active: false });
  await waitForTabLoad(newTab.id);
  for (let i = 0; i < 8; i++) {
    await delay(500);
    if (await pingTab(newTab.id)) { s2TabCache = newTab.id; return newTab.id; }
  }
  throw new Error("Content script did not respond in the new S2 tab");
}

async function getReachableS2TabIdIfAvailable() {
  if (s2TabCache !== null && await pingTab(s2TabCache)) return s2TabCache;
  const tabs = await chrome.tabs.query({ url: "https://www.semanticscholar.org/*" });
  for (const tab of tabs) {
    if (await pingTab(tab.id)) { s2TabCache = tab.id; return tab.id; }
  }
  return null;
}

async function s2Op(op, data = {}) {
  const tabId = await getReachableS2TabId();
  return sendMessage(tabId, { type: "S2_OP", op, ...data });
}

async function checkS2Login() {
  const tabs = await chrome.tabs.query({ url: "https://www.semanticscholar.org/*" });
  for (const tab of tabs) {
    if (await pingTab(tab.id)) {
      try {
        const res = await sendMessage(tab.id, { type: "S2_OP", op: "CHECK_LOGIN" });
        if (typeof res?.loggedIn === "boolean") return res.loggedIn;
      } catch {}
    }
  }
  const cookies = await chrome.cookies.getAll({ url: "https://www.semanticscholar.org/" });
  return cookies.some(c => c.value.length > 50 && !ANALYTICS_COOKIE.test(c.name));
}

// ─────────────────────────────────────────────────────────────────────────────
// Zotero API
// ─────────────────────────────────────────────────────────────────────────────

async function zoteroFetch(path, apiKey, start = 0) {
  const r = await fetch(`${ZOTERO_BASE}${path}?limit=100&start=${start}`, {
    headers: { "Zotero-API-Key": apiKey, "Zotero-API-Version": "3" },
  });
  if (!r.ok) throw new Error(`Zotero ${r.status}: ${await r.text()}`);
  return {
    data:  await r.json(),
    total: parseInt(r.headers.get("Total-Results") ?? "0", 10),
  };
}

async function getCollections(libraryId, apiKey) {
  const allData = [];
  let start = 0;
  while (true) {
    const { data, total } = await zoteroFetch(`/users/${libraryId}/collections`, apiKey, start);
    allData.push(...data);
    start += 100;
    if (start >= total || !data.length) break;
  }
  const byKey = Object.fromEntries(allData.map(c => [c.key, c]));
  function depth(c) {
    const p = c.data.parentCollection;
    return !p ? 0 : (byKey[p] ? 1 + depth(byKey[p]) : 1);
  }
  return allData
    .map(c => ({
      key:       c.key,
      name:      c.data.name,
      parentKey: c.data.parentCollection || null,
      count:     c.meta?.numItems ?? 0,
      display:   "　".repeat(depth(c)) + c.data.name,
    }))
    .sort((a, b) => a.display.localeCompare(b.display));
}

function expandCollectionKeys(selectedKeys, allCollections) {
  const result = new Set(selectedKeys);
  let changed = true;
  while (changed) {
    changed = false;
    for (const c of allCollections) {
      if (c.parentKey && result.has(c.parentKey) && !result.has(c.key)) {
        result.add(c.key);
        changed = true;
      }
    }
  }
  return [...result];
}

function extractArxivId(url = "") {
  const m = url.match(/arxiv\.org\/abs\/(\d{4}\.\d{4,5}(?:v\d+)?)/i);
  return m ? m[1] : "";
}

async function getPapers(libraryId, apiKey, collectionKey) {
  const papers = [];
  let start = 0;
  while (true) {
    const { data, total } = await zoteroFetch(
      `/users/${libraryId}/collections/${collectionKey}/items/top`, apiKey, start
    );
    if (!data.length) break;
    for (const item of data) {
      const d = item.data ?? {};
      if (!PAPER_TYPES.has(d.itemType)) continue;
      const title = (d.title ?? "").trim();
      if (!title) continue;
      papers.push({
        zoteroKey: item.key,
        title,
        doi:     (d.DOI ?? "").trim(),
        arxivId: extractArxivId(d.url ?? "") || extractArxivId(d.extra ?? ""),
      });
    }
    start += 100;
    if (start >= total) break;
  }
  return papers;
}

// ─────────────────────────────────────────────────────────────────────────────
// S2 paper lookup
// ─────────────────────────────────────────────────────────────────────────────

function normTitle(s) {
  return s
    .normalize("NFKC")
    .replace(/[‐-―−﹘﹣－]/g, "-")
    .replace(/[^\w\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function titleSimilarity(a, b) {
  const tokens = s => new Set(s.split(/\s+/).filter(w => w.length > 2));
  const A = tokens(a), B = tokens(b);
  let common = 0;
  for (const w of A) if (B.has(w)) common++;
  const union = A.size + B.size - common;
  return union === 0 ? 0 : common / union;
}

function titleMatch(a, b, threshold = 0.50) {
  const na = normTitle(a), nb = normTitle(b);
  if (na === nb) return true;
  return titleSimilarity(na, nb) >= threshold;
}

async function findS2Id(paper, s2ApiKey) {
  const qs = "fields=paperId,title";

  async function s2Fetch(url) {
    if (s2ApiKey) {
      const r = await fetch(url, { headers: { "x-api-key": s2ApiKey } });
      if (r.status === 401 || r.status === 403) return fetch(url);
      return r;
    }
    return fetch(url);
  }

  if (paper.arxivId) {
    try {
      const r = await s2Fetch(`${S2_PUBLIC}/paper/arXiv:${paper.arxivId}?${qs}`);
      if (r.ok) return (await r.json()).paperId;
    } catch {}
  }

  if (paper.doi) {
    const doi = paper.doi.replace(/^https?:\/\/doi\.org\//i, "").replace(/^doi:/i, "");
    try {
      const r = await s2Fetch(`${S2_PUBLIC}/paper/DOI:${encodeURIComponent(doi)}?${qs}`);
      if (r.ok) return (await r.json()).paperId;
    } catch {}
  }

  const cleanTitle = paper.title.replace(/:/g, " ").replace(/\s+/g, " ").trim();
  const queries = [cleanTitle];
  if (paper.title.includes(":")) {
    const subtitle = paper.title.slice(paper.title.indexOf(":") + 1).trim();
    if (subtitle.length > 10) queries.push(subtitle);
    const mainTitle = paper.title.slice(0, paper.title.indexOf(":")).trim();
    if (mainTitle.length > 10 && !queries.includes(mainTitle)) queries.push(mainTitle);
  }

  let bestId = null, bestSim = 0;

  function checkResults(results, isFullTitle) {
    for (let ri = 0; ri < results.length; ri++) {
      const c = results[ri];
      const ct = c.title ?? "";
      if (!ct) continue;
      const sim = titleSimilarity(normTitle(paper.title), normTitle(ct));
      if (titleMatch(paper.title, ct)) return c.paperId;
      if (isFullTitle && ri === 0 && sim >= 0.20) return c.paperId;
      if (sim > bestSim) { bestSim = sim; bestId = c.paperId; }
    }
    return null;
  }

  try {
    const oaRes = await fetch(
      `https://api.openalex.org/works?search=${encodeURIComponent(cleanTitle)}&per_page=10&select=doi,display_name`,
      { headers: { "User-Agent": "ZotScholar/2.0" } }
    );
    if (oaRes.ok) {
      const works = (await oaRes.json()).results ?? [];
      for (let wi = 0; wi < works.length; wi++) {
        const work = works[wi];
        if (!work.doi || !work.display_name) continue;
        const sim = titleSimilarity(normTitle(paper.title), normTitle(work.display_name));
        const isFirst = wi === 0;
        if (!titleMatch(paper.title, work.display_name) && !(isFirst && sim >= 0.25)) continue;
        const doi = work.doi.replace(/^https?:\/\/doi\.org\//i, "");
        const r = await s2Fetch(`${S2_PUBLIC}/paper/DOI:${encodeURIComponent(doi)}?${qs}`);
        if (r.ok) return (await r.json()).paperId;
      }
    }
  } catch {}

  try {
    const tabId = await getReachableS2TabIdIfAvailable();
    if (tabId) {
      const { papers } = await sendMessage(tabId, { type: "S2_OP", op: "SEARCH_PAPER", query: cleanTitle });
      const hit = checkResults(papers ?? [], true);
      if (hit) return hit;
    }
  } catch {}

  for (let qi = 0; qi < queries.length; qi++) {
    const q = queries[qi];
    const isFullTitle = qi === 0;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const r = await s2Fetch(`${S2_PUBLIC}/paper/search?query=${encodeURIComponent(q)}&${qs}&limit=50`);
        if (r.status === 429) { await delay(5000); continue; }
        if (!r.ok) break;
        const hit = checkResults((await r.json()).data ?? [], isFullTitle);
        if (hit) return hit;
        break;
      } catch {}
    }
  }

  if (bestId && bestSim >= 0.20) return bestId;
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

function getStorage(keys) {
  return new Promise(r => chrome.storage.local.get(keys, r));
}

// ─────────────────────────────────────────────────────────────────────────────
// Job state helpers
// ─────────────────────────────────────────────────────────────────────────────

async function isCancelled() {
  const { cancelRequested } = await getStorage("cancelRequested");
  if (cancelRequested) await chrome.storage.local.remove(["jobState", "cancelRequested"]);
  return !!cancelRequested;
}

function setJobState(data) {
  chrome.storage.local.set({ jobState: { ...data, updatedAt: Date.now() } });
}

// ─────────────────────────────────────────────────────────────────────────────
// Watched-collection helpers
// ─────────────────────────────────────────────────────────────────────────────

// Mark collections as watched and persist newly synced paper keys + folder id.
async function updateWatchedCollections(resultGroups, existingWatched) {
  const updated = { ...existingWatched };
  for (const g of resultGroups) {
    if (!g.folderId) continue;
    const prev = existingWatched[g.key]?.syncedItemKeys ?? [];
    updated[g.key] = {
      name:          g.name,
      s2FolderId:    g.folderId,
      lastSyncAt:    Date.now(),
      syncedItemKeys: [...new Set([...prev, ...g.newlySyncedKeys])],
    };
  }
  await chrome.storage.local.set({ watchedCollections: updated });
}

// ─────────────────────────────────────────────────────────────────────────────
// Core sync pipeline  (shared by START_JOB and AUTO_SYNC)
// ─────────────────────────────────────────────────────────────────────────────

async function runSyncPipeline({ zoteroId, zoteroKey, s2Key, groups, watchedCollections, onProgress }) {
  // groups: [{ key, name, papers, skippedCount, existingFolderId }]
  //   papers = only the NEW (non-skipped) papers to process

  const totalSkipped = groups.reduce((s, g) => s + g.skippedCount, 0);
  const findTotal    = groups.reduce((s, g) => s + g.papers.length, 0);

  // ── Phase 1: find S2 IDs ─────────────────────────────────────────────────
  onProgress?.({ phase: "finding", findCurrent: 0, findTotal, totalSkipped });

  const resultGroups = [];
  let findDone = 0;

  for (const group of groups) {
    const found = [], missing = [];
    for (const p of group.papers) {
      onProgress?.({ phase: "finding", findCurrent: findDone, findTotal,
        findLabel: p.title.slice(0, 60), totalSkipped });
      const pid = await findS2Id(p, s2Key || null);
      if (pid) found.push({ id: pid, title: p.title, zoteroKey: p.zoteroKey });
      else     missing.push(p.title);
      findDone++;
      await delay(200);
    }
    resultGroups.push({
      key:          group.key,
      name:         group.name,
      skippedCount: group.skippedCount,
      existingFolderId: group.existingFolderId,
      found,
      missing,
      folderId:     null,
      newlySyncedKeys: [],
    });
  }

  const findStats = {
    found:         resultGroups.reduce((s, g) => s + g.found.length, 0),
    missing:       resultGroups.reduce((s, g) => s + g.missing.length, 0),
    skipped:       totalSkipped,
    missingTitles: resultGroups.flatMap(g => g.missing),
  };

  if (findStats.found === 0) {
    return { findStats, importResults: { ok: 0, already: 0, fail: 0, failedIds: [] }, resultGroups };
  }

  // ── Phase 2: import into S2 ──────────────────────────────────────────────
  const importTotal = findStats.found;
  let ok = 0, already = 0, fail = 0;
  const failedIds = [];
  let importDone = 0;

  for (const group of resultGroups) {
    if (!group.found.length) continue;

    const { folderId } = await s2Op("GET_OR_CREATE_FOLDER", { folderName: group.name });
    group.folderId = folderId;

    for (let i = 0; i < group.found.length; i++) {
      const paper = group.found[i];
      onProgress?.({
        phase: "importing", findStats,
        importCurrent: importDone, importTotal,
        importLabel: `"${group.name}": ${i + 1}/${group.found.length}`,
        importFolderName: group.name,
      });
      try {
        const { result } = await s2Op("ADD_PAPER", {
          paperId: paper.id, paperTitle: paper.title, folderId,
        });
        if (result === "ok") {
          ok++;
          group.newlySyncedKeys.push(paper.zoteroKey);
        } else if (result === "already") {
          already++;
          group.newlySyncedKeys.push(paper.zoteroKey);
        } else {
          fail++;
          failedIds.push(paper.id);
        }
      } catch {
        fail++;
        failedIds.push(paper.id);
      }
      importDone++;
      await delay(300);
    }
  }

  return { findStats, importResults: { ok, already, fail, failedIds }, resultGroups };
}

// ─────────────────────────────────────────────────────────────────────────────
// Alarm: re-create on extension install/update if interval was saved
// ─────────────────────────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(async () => {
  const { syncInterval } = await getStorage("syncInterval");
  await chrome.alarms.clearAll();
  if (syncInterval > 0) {
    chrome.alarms.create("zotscholar-sync", { periodInMinutes: syncInterval });
  }
});

chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === "zotscholar-sync") {
    handle({ type: "AUTO_SYNC" }).catch(() => {});
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Message handler
// ─────────────────────────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  handle(msg)
    .then(sendResponse)
    .catch(e => sendResponse({ error: e.message ?? String(e) }));
  return true;
});

async function handle(msg) {
  switch (msg.type) {

    case "GET_COLLECTIONS":
      return { collections: await getCollections(msg.libraryId, msg.apiKey) };

    case "CHECK_S2_LOGIN":
      return { loggedIn: await checkS2Login() };

    // ── Manual import / incremental update ─────────────────────────────────
    case "START_JOB": {
      const stored = await getStorage(["zoteroId", "zoteroKey", "s2Key", "collections", "watchedCollections"]);
      const { zoteroId, zoteroKey, s2Key, collections: allCollections, watchedCollections = {} } = stored;

      if (!zoteroId || !zoteroKey) {
        setJobState({ status: "error", error: "CREDENTIALS_MISSING" });
        return { error: "CREDENTIALS_MISSING" };
      }

      const expanded  = allCollections
        ? expandCollectionKeys(msg.collectionKeys, allCollections)
        : msg.collectionKeys;
      const keyToName = Object.fromEntries((allCollections ?? []).map(c => [c.key, c.name]));

      await chrome.storage.local.remove("cancelRequested");
      setJobState({ status: "fetching" });

      // ── Phase 0: fetch Zotero papers, split into new vs. already-synced ──
      const groups = [];
      for (const key of expanded) {
        if (await isCancelled()) return { cancelled: true };
        const allPapers = await getPapers(zoteroId, zoteroKey, key);
        if (!allPapers.length) continue;

        const watched    = watchedCollections[key];
        const syncedKeys = new Set(watched?.syncedItemKeys ?? []);
        const newPapers  = allPapers.filter(p => !syncedKeys.has(p.zoteroKey));

        groups.push({
          key,
          name:             keyToName[key] ?? key,
          papers:           newPapers,
          skippedCount:     allPapers.length - newPapers.length,
          existingFolderId: watched?.s2FolderId ?? null,
        });
      }

      if (!groups.length) {
        await chrome.storage.local.remove("jobState");
        return { error: "No papers found in selected collections" };
      }

      const totalSkipped = groups.reduce((s, g) => s + g.skippedCount, 0);
      const findTotal    = groups.reduce((s, g) => s + g.papers.length, 0);

      // All papers already synced — nothing to do
      if (findTotal === 0) {
        const findStats = { found: 0, missing: 0, skipped: totalSkipped, missingTitles: [] };
        setJobState({ status: "done", findStats, importTotal: 0,
          importResults: { ok: 0, already: 0, fail: 0, failedIds: [] } });
        return { findStats, importResults: { ok: 0, already: 0, fail: 0, failedIds: [] } };
      }

      // ── Check S2 login before starting (avoids long find phase then failure)
      const loggedIn = await checkS2Login();
      if (!loggedIn) {
        setJobState({ status: "error", error: "NOT_LOGGED_IN" });
        throw new Error("NOT_LOGGED_IN");
      }

      let lastCancelCheck = 0;
      const { findStats, importResults, resultGroups } = await runSyncPipeline({
        zoteroId, zoteroKey, s2Key, groups, watchedCollections,
        onProgress: async (p) => {
          // Cancel check every 5 papers during find phase
          if (p.phase === "finding") {
            if (p.findCurrent - lastCancelCheck >= 5) {
              lastCancelCheck = p.findCurrent;
              if (await isCancelled()) throw new Error("CANCELLED");
            }
            if (p.findCurrent % 3 === 0) {
              setJobState({ status: "finding", findCurrent: p.findCurrent,
                findTotal: p.findTotal, findLabel: p.findLabel ?? "",
                totalSkipped: p.totalSkipped });
            }
          } else if (p.phase === "importing") {
            if (p.importCurrent % 3 === 0) {
              setJobState({ status: "importing", findStats: p.findStats,
                importCurrent: p.importCurrent, importTotal: p.importTotal,
                importLabel: p.importLabel, importFolderName: p.importFolderName });
            }
          }
        },
      });

      // Persist watched-collection state for all processed groups
      await updateWatchedCollections(resultGroups, watchedCollections);

      const importedFolderIds = resultGroups
        .filter(g => g.folderId && g.found.length > 0)
        .map(g => g.folderId);

      setJobState({ status: "done", findStats, importTotal: findStats.found, importResults, importedFolderIds });
      return { findStats, importResults };
    }

    case "GET_FOLDERS_STATUS":
      return s2Op("LIST_FOLDERS");

    case "TOGGLE_RECOMMENDATION": {
      const { folderId, status } = msg;
      await s2Op("SET_FOLDER_RECOMMENDATION", { folderId, status });
      return { ok: true };
    }

    case "ENABLE_RECOMMENDATION": {
      const { folderIds = [] } = msg;
      const results = await Promise.allSettled(
        folderIds.map(id => s2Op("SET_FOLDER_RECOMMENDATION", { folderId: id }))
      );
      const failed = results.filter(r => r.status === "rejected").length;
      return { ok: true, enabled: folderIds.length - failed, failed };
    }

    case "CANCEL_JOB":
      await chrome.storage.local.set({ cancelRequested: true });
      return { ok: true };

    // ── Alarm-triggered background sync ────────────────────────────────────
    case "AUTO_SYNC": {
      // Don't conflict with a running manual job
      const { jobState, watchedCollections = {}, zoteroId, zoteroKey, s2Key } =
        await getStorage(["jobState", "watchedCollections", "zoteroId", "zoteroKey", "s2Key"]);

      if (jobState && ["fetching", "finding", "importing"].includes(jobState.status)) {
        return { skipped: "job_in_progress" };
      }

      const watchedKeys = Object.keys(watchedCollections);
      if (!watchedKeys.length || !zoteroId || !zoteroKey) return { skipped: "nothing_to_sync" };

      const loggedIn = await checkS2Login();
      if (!loggedIn) {
        await chrome.storage.local.set({
          lastAutoSync: { at: Date.now(), status: "error", error: "NOT_LOGGED_IN" }
        });
        return { error: "NOT_LOGGED_IN" };
      }

      // Build groups for all watched collections
      const groups = [];
      for (const key of watchedKeys) {
        const watched    = watchedCollections[key];
        const allPapers  = await getPapers(zoteroId, zoteroKey, key).catch(() => []);
        if (!allPapers.length) continue;
        const syncedKeys = new Set(watched.syncedItemKeys ?? []);
        const newPapers  = allPapers.filter(p => !syncedKeys.has(p.zoteroKey));
        groups.push({
          key,
          name:             watched.name,
          papers:           newPapers,
          skippedCount:     allPapers.length - newPapers.length,
          existingFolderId: watched.s2FolderId ?? null,
        });
      }

      const { findStats, importResults, resultGroups } =
        await runSyncPipeline({ zoteroId, zoteroKey, s2Key, groups, watchedCollections });

      await updateWatchedCollections(resultGroups, watchedCollections);
      await chrome.storage.local.set({
        lastAutoSync: {
          at:       Date.now(),
          status:   "ok",
          added:    importResults.ok,
          skipped:  findStats.skipped,
          notFound: findStats.missing,
          errors:   importResults.fail,
        },
      });
      return { findStats, importResults };
    }

    // ── Sync interval ───────────────────────────────────────────────────────
    // ── Auto-detect existing S2 folders that match Zotero collections ──────
    case "DETECT_WATCHED": {
      const { collections: allCollections = [], watchedCollections = {} } =
        await getStorage(["collections", "watchedCollections"]);

      const { folders } = await s2Op("LIST_FOLDERS");
      // Build a name → folder map (lower-cased for matching)
      const s2ByName = {};
      for (const f of folders) s2ByName[f.name.toLowerCase()] = f;

      const added = {};
      for (const col of allCollections) {
        if (watchedCollections[col.key]) continue;          // already registered
        const match = s2ByName[col.name.toLowerCase()];
        if (!match) continue;
        added[col.key] = {
          name:          col.name,
          s2FolderId:    match.id,
          lastSyncAt:    null,
          syncedItemKeys: [],
        };
      }

      if (Object.keys(added).length) {
        await chrome.storage.local.set({
          watchedCollections: { ...watchedCollections, ...added },
        });
      }
      return { detected: Object.keys(added).length, added };
    }

    case "SET_SYNC_INTERVAL": {
      const { minutes } = msg;
      await chrome.storage.local.set({ syncInterval: minutes });
      await chrome.alarms.clearAll();
      if (minutes > 0) {
        chrome.alarms.create("zotscholar-sync", { periodInMinutes: minutes });
      }
      return { ok: true };
    }

    default:
      throw new Error(`Unknown message type: ${msg.type}`);
  }
}
