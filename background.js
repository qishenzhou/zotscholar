// background.js — service worker

const ZOTERO_BASE = "https://api.zotero.org";
const S2_PUBLIC   = "https://api.semanticscholar.org/graph/v1";

const PAPER_TYPES = new Set([
  "journalArticle", "conferencePaper", "preprint",
  "report", "thesis", "bookSection", "book",
]);

// ─────────────────────────────────────────────────────────────────────────────
// S2 tab communication
//
// Strategy: always use sendMessage to the content script (declared in manifest).
// If no existing tab has a reachable content script, open a hidden background
// tab — the manifest guarantees content.js runs on every new S2 page load.
// executeScript is intentionally avoided: Chrome blocks it on tabs opened
// before the extension was installed/reloaded, even with correct host_permissions.
// ─────────────────────────────────────────────────────────────────────────────

const ANALYTICS_COOKIE = /^(_ga|_gid|_gat|amp_|ajs_|anon_|intercom)/;

// Cached tab id that we know has a live content script
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
  // 1. Try cached tab
  if (s2TabCache !== null) {
    if (await pingTab(s2TabCache)) return s2TabCache;
    s2TabCache = null;
  }

  // 2. Try all existing S2 tabs
  const tabs = await chrome.tabs.query({ url: "https://www.semanticscholar.org/*" });
  for (const tab of tabs) {
    if (await pingTab(tab.id)) {
      s2TabCache = tab.id;
      return tab.id;
    }
  }

  // 3. Open a hidden background tab — content script will be auto-injected
  const newTab = await chrome.tabs.create({
    url: "https://www.semanticscholar.org/",
    active: false,
  });
  await waitForTabLoad(newTab.id);

  // Retry ping up to 8 times (content script may need a moment to register)
  for (let i = 0; i < 8; i++) {
    await delay(500);
    if (await pingTab(newTab.id)) {
      s2TabCache = newTab.id;
      return newTab.id;
    }
  }
  throw new Error("Content script did not respond in the new S2 tab");
}

async function s2Op(op, data = {}) {
  const tabId = await getReachableS2TabId();
  return sendMessage(tabId, { type: "S2_OP", op, ...data });
}

async function checkS2Login() {
  // For the login check we prefer NOT to open a new tab — use cookies as fallback
  const tabs = await chrome.tabs.query({ url: "https://www.semanticscholar.org/*" });
  for (const tab of tabs) {
    if (await pingTab(tab.id)) {
      try {
        const res = await sendMessage(tab.id, { type: "S2_OP", op: "CHECK_LOGIN" });
        if (typeof res?.loggedIn === "boolean") return res.loggedIn;
      } catch {}
    }
  }
  // Fallback: cookie presence check (no tab open required)
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

async function getPapersFromMultiple(libraryId, apiKey, collectionKeys) {
  const seen = new Set();
  const papers = [];
  for (const key of collectionKeys) {
    for (const p of await getPapers(libraryId, apiKey, key)) {
      const dedupeKey = p.doi || p.arxivId || normTitle(p.title);
      if (!seen.has(dedupeKey)) {
        seen.add(dedupeKey);
        papers.push(p);
      }
    }
  }
  return papers;
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
// S2 paper lookup  (public API, no auth needed)
// ─────────────────────────────────────────────────────────────────────────────

// Normalize title for comparison: Unicode NFKC, all dashes → hyphen, lowercase
function normTitle(s) {
  return s
    .normalize("NFKC")
    .replace(/[‐-―−﹘﹣－]/g, "-") // dash variants
    .replace(/[^\w\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function titleSimilarity(a, b) {
  const tokens = s =>
    new Set(s.split(/\s+/).filter(w => w.length > 2));
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

  // Fetch helper: if S2 API key causes a 4xx, silently retry without it
  async function s2Fetch(url) {
    if (s2ApiKey) {
      const r = await fetch(url, { headers: { "x-api-key": s2ApiKey } });
      if (r.status === 401 || r.status === 403) {
        return fetch(url); // bad key — retry without
      }
      return r;
    }
    return fetch(url);
  }

  // 1. arXiv ID — most precise for preprints
  if (paper.arxivId) {
    try {
      const r = await s2Fetch(`${S2_PUBLIC}/paper/arXiv:${paper.arxivId}?${qs}`);
      if (r.ok) return (await r.json()).paperId;
    } catch {}
  }

  // 2. DOI
  if (paper.doi) {
    const doi = paper.doi.replace(/^https?:\/\/doi\.org\//i, "").replace(/^doi:/i, "");
    try {
      const r = await s2Fetch(`${S2_PUBLIC}/paper/DOI:${encodeURIComponent(doi)}?${qs}`);
      if (r.ok) return (await r.json()).paperId;
    } catch {}
  }

  // 3. Title search — build multiple query variants
  // Colons are treated as field separators in search engines, so strip them
  const cleanTitle = paper.title.replace(/:/g, " ").replace(/\s+/g, " ").trim();
  const queries = [cleanTitle];

  // Also try the part after the colon (subtitle) if meaningful
  if (paper.title.includes(":")) {
    const subtitle = paper.title.slice(paper.title.indexOf(":") + 1).trim();
    if (subtitle.length > 10) queries.push(subtitle);
  }

  // Also try the part before the colon (main title) if the clean title differs
  if (paper.title.includes(":")) {
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

  // 3a. OpenAlex title search → DOI → S2 ID (most reliable path for title-only papers)
  try {
    const oaRes = await fetch(
      `https://api.openalex.org/works?search=${encodeURIComponent(cleanTitle)}&per_page=10&select=doi,display_name`,
      { headers: { "User-Agent": "ZoteroToS2Extension/1.3" } }
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

  // 3b. Internal S2 search — matches website ranking exactly
  try {
    const tabId = await getReachableS2TabIdIfAvailable();
    if (tabId) {
      const { papers } = await sendMessage(tabId, {
        type: "S2_OP", op: "SEARCH_PAPER", query: cleanTitle,
      });
      const hit = checkResults(papers ?? [], true);
      if (hit) return hit;
    }
  } catch {}

  // 3c. Public S2 API title search — broader coverage as last resort
  for (let qi = 0; qi < queries.length; qi++) {
    const q = queries[qi];
    const isFullTitle = qi === 0;

    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const r = await s2Fetch(
          `${S2_PUBLIC}/paper/search?query=${encodeURIComponent(q)}&${qs}&limit=50`
        );
        if (r.status === 429) { await delay(5000); continue; }
        if (!r.ok) break;
        const hit = checkResults((await r.json()).data ?? [], isFullTitle);
        if (hit) return hit;
        break;
      } catch {}
    }
  }

  // Final fallback: best candidate with similarity ≥ 0.20
  if (bestId && bestSim >= 0.20) return bestId;
  return null;
}

async function getReachableS2TabIdIfAvailable() {
  if (s2TabCache !== null && await pingTab(s2TabCache)) return s2TabCache;
  const tabs = await chrome.tabs.query({ url: "https://www.semanticscholar.org/*" });
  for (const tab of tabs) {
    if (await pingTab(tab.id)) { s2TabCache = tab.id; return tab.id; }
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

function sendProgress(phase, current, total, label = "") {
  chrome.runtime.sendMessage({ type: "PROGRESS", phase, current, total, label }).catch(() => {});
}

function setImportState(data) {
  chrome.storage.local.set({ importState: { ...data, updatedAt: Date.now() } });
}

function clearImportState() {
  chrome.storage.local.remove("importState");
}

// ─────────────────────────────────────────────────────────────────────────────
// Main message handler
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

    case "GET_PAPERS": {
      const keys     = msg.collectionKeys ?? (msg.collectionKey ? [msg.collectionKey] : []);
      const expanded = msg.allCollections
        ? expandCollectionKeys(keys, msg.allCollections)
        : keys;
      const keyToName = Object.fromEntries(
        (msg.allCollections ?? []).map(c => [c.key, c.name])
      );
      const groups = [];
      for (const key of expanded) {
        const papers = await getPapers(msg.libraryId, msg.apiKey, key);
        if (papers.length > 0) {
          groups.push({ key, name: keyToName[key] ?? key, papers });
        }
      }
      return { groups };
    }

    case "CHECK_S2_LOGIN":
      return { loggedIn: await checkS2Login() };

    case "CHECK_S2_KEY": {
      if (!msg.s2ApiKey) return { valid: false, reason: "empty" };
      try {
        const r = await fetch(
          `${S2_PUBLIC}/paper/search?query=deep+learning&fields=paperId&limit=1`,
          { headers: { "x-api-key": msg.s2ApiKey } }
        );
        if (r.ok) return { valid: true };
        if (r.status === 401 || r.status === 403) return { valid: false, reason: "unauthorized" };
        if (r.status === 429) return { valid: true, reason: "rate_limited" }; // key is real, just hit limit
        return { valid: false, reason: `http_${r.status}` };
      } catch (e) {
        return { valid: false, reason: e.message };
      }
    }

    case "RESOLVE_PAPERS": {
      // msg.groups: [{key, name, papers: [{title, doi, arxivId}]}]
      const groups = msg.groups ?? [];
      const total  = groups.reduce((s, g) => s + g.papers.length, 0);
      const resultGroups = [];
      let done = 0;

      chrome.storage.local.set({
        resolveState: { status: "running", current: 0, total, label: "", updatedAt: Date.now() },
      });

      for (const group of groups) {
        const found = [], missing = [];
        for (const p of group.papers) {
          const label = p.title.slice(0, 60);
          sendProgress("resolve", done, total, label);
          if (done % 5 === 0) {
            chrome.storage.local.set({
              resolveState: { status: "running", current: done, total, label, updatedAt: Date.now() },
            });
          }
          const pid = await findS2Id(p, msg.s2ApiKey ?? null);
          if (pid) found.push({ id: pid, title: p.title });
          else missing.push(p.title);
          done++;
          await delay(200);
        }
        resultGroups.push({ key: group.key, name: group.name, found, missing });
      }

      sendProgress("resolve", total, total, "");

      if (resultGroups.some(g => g.found.length > 0)) {
        await chrome.storage.local.set({ pendingImport: { groups: resultGroups } });
      }
      await chrome.storage.local.set({ resolveState: { status: "done" } });

      return { groups: resultGroups };
    }

    case "IMPORT_PAPERS": {
      const loggedIn = await checkS2Login();
      if (!loggedIn) throw new Error("NOT_LOGGED_IN");

      // msg.groups: [{key, name, found: [{id, title}], missing: [...]}]
      const groups = msg.groups ?? [];
      const total  = groups.reduce((s, g) => s + g.found.length, 0);

      let ok = 0, already = 0, fail = 0;
      const failedIds = [];
      let papersDone = 0;

      setImportState({ status: "running", current: 0, total, label: "", folderName: groups[0]?.name ?? "" });

      for (const group of groups) {
        if (!group.found.length) continue;

        const { folderId } = await s2Op("GET_OR_CREATE_FOLDER", { folderName: group.name });

        for (let i = 0; i < group.found.length; i++) {
          const paper = group.found[i];
          const label = `"${group.name}": ${i + 1}/${group.found.length}`;
          sendProgress("import", papersDone, total, label);
          if (papersDone % 5 === 0) {
            setImportState({ status: "running", current: papersDone, total, label, folderName: group.name });
          }
          try {
            const { result } = await s2Op("ADD_PAPER", {
              paperId:    paper.id,
              paperTitle: paper.title,
              folderId,
            });
            if (result === "ok")           ok++;
            else if (result === "already") already++;
            else                           { fail++; failedIds.push(paper.id); }
          } catch {
            fail++;
            failedIds.push(paper.id);
          }
          papersDone++;
          await delay(300);
        }
      }

      sendProgress("import", total, total, "");
      const results = { ok, already, fail, failedIds };
      setImportState({ status: "done", results });
      return results;
    }

    default:
      throw new Error(`Unknown message type: ${msg.type}`);
  }
}
