// popup.js

const $ = id => document.getElementById(id);

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function showPanel(n) {
  [0, 1].forEach(i => {
    $(`panel-${i}`).classList.toggle("hidden", i !== n);
    const el = document.querySelector(`.step[data-step="${i}"]`);
    el.classList.remove("active", "done");
    if (i < n)  el.classList.add("done");
    if (i === n) el.classList.add("active");
  });
}

function setProgress(id, current, total, label) {
  const pct = total > 0 ? Math.round(current / total * 100) : 0;
  $(`${id}-bar`).style.width = `${pct}%`;
  $(`${id}-label`).textContent = label ?? "";
}

function setError(id, msg) {
  const el = $(id);
  if (msg) { el.textContent = msg; el.classList.remove("hidden"); }
  else       el.classList.add("hidden");
}

function loadStorage(keys) {
  return new Promise(r => chrome.storage.local.get(keys, r));
}

function clearJobState() {
  chrome.storage.local.remove(["jobState", "cancelRequested"]);
}

// ─────────────────────────────────────────────────────────────────────────────
// Collection tree
// ─────────────────────────────────────────────────────────────────────────────

let cachedCollections  = [];
let cachedWatched      = {};

function buildTree(collections) {
  const map = {};
  for (const c of collections) map[c.key] = { ...c, children: [] };
  const roots = [];
  for (const c of collections) {
    if (c.parentKey && map[c.parentKey]) map[c.parentKey].children.push(map[c.key]);
    else roots.push(map[c.key]);
  }
  const sort = arr => {
    arr.sort((a, b) => a.name.localeCompare(b.name));
    arr.forEach(n => sort(n.children));
  };
  sort(roots);
  return roots;
}

function renderTreeNode(node, parentKey) {
  const item = document.createElement("div");
  item.className = "tree-item";

  const row = document.createElement("div");
  row.className = "tree-row";

  const toggle = document.createElement("span");
  toggle.className = node.children.length ? "tree-toggle" : "tree-toggle tree-leaf";
  toggle.textContent = node.children.length ? "▶" : "";

  const cb = document.createElement("input");
  cb.type = "checkbox";
  cb.id   = `cb-${node.key}`;
  cb.className         = "tree-cb";
  cb.dataset.key       = node.key;
  cb.dataset.parentKey = parentKey ?? "";

  const lbl = document.createElement("label");
  lbl.htmlFor   = `cb-${node.key}`;
  lbl.className = "tree-label";
  lbl.title     = `${node.name} — ${node.count} direct item(s)`;
  lbl.textContent = `${node.name}  (${node.count})`;

  const els = [toggle, cb, lbl];
  if (cachedWatched[node.key]) {
    const dot = document.createElement("span");
    dot.className = "sync-dot";
    dot.title = "Auto-sync enabled";
    els.push(dot);
  }
  row.append(...els);
  item.appendChild(row);

  if (node.children.length) {
    const childrenDiv = document.createElement("div");
    childrenDiv.className = "tree-children collapsed";
    for (const child of node.children) {
      childrenDiv.appendChild(renderTreeNode(child, node.key));
    }
    item.appendChild(childrenDiv);

    toggle.addEventListener("click", e => {
      e.stopPropagation();
      const collapsed = childrenDiv.classList.toggle("collapsed");
      toggle.textContent = collapsed ? "▶" : "▼";
    });
  }

  cb.addEventListener("change", () => {
    item.querySelectorAll(".tree-cb").forEach(c => {
      c.checked = cb.checked;
      c.indeterminate = false;
    });
    updateAncestors(cb.dataset.parentKey);
    updateStartButton();
  });

  return item;
}

function updateAncestors(parentKey) {
  if (!parentKey) return;
  const parentCb = document.getElementById(`cb-${parentKey}`);
  if (!parentCb) return;

  const parentItem = parentCb.closest(".tree-item");
  const childrenDiv = parentItem?.querySelector(":scope > .tree-children");
  if (!childrenDiv) return;

  const childCbs = Array.from(
    childrenDiv.querySelectorAll(":scope > .tree-item > .tree-row > .tree-cb")
  );
  const checked = childCbs.filter(c => c.checked && !c.indeterminate).length;
  const indet   = childCbs.filter(c => c.indeterminate).length;

  if (checked === childCbs.length && indet === 0) {
    parentCb.checked = true; parentCb.indeterminate = false;
  } else if (checked === 0 && indet === 0) {
    parentCb.checked = false; parentCb.indeterminate = false;
  } else {
    parentCb.checked = false; parentCb.indeterminate = true;
  }
  updateAncestors(parentCb.dataset.parentKey);
}

function mountTree(collections, watched) {
  cachedCollections = collections;
  if (watched !== undefined) cachedWatched = watched;
  const container = $("collection-tree");
  container.innerHTML = "";
  for (const root of buildTree(collections)) {
    container.appendChild(renderTreeNode(root, ""));
  }
  $("tree-wrap").classList.remove("hidden");
  $("collections-loading").classList.add("hidden");
  updateStartButton();
}

function getSelectedKeys() {
  return Array.from(document.querySelectorAll(".tree-cb:checked")).map(cb => cb.dataset.key);
}

function updateStartButton() {
  $("btn-start-job").disabled = getSelectedKeys().length === 0;
}

async function fetchAndMountCollections(libraryId, apiKey) {
  $("collections-loading").classList.remove("hidden");
  $("tree-wrap").classList.add("hidden");
  setError("tree-error", null);
  try {
    const res = await chrome.runtime.sendMessage({ type: "GET_COLLECTIONS", libraryId, apiKey });
    if (res.error) throw new Error(res.error);
    chrome.storage.local.set({ collections: res.collections });
    mountTree(res.collections);
  } catch (e) {
    $("collections-loading").classList.add("hidden");
    setError("tree-error", `Failed to load collections: ${e.message}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Job state rendering (Panel 1)
// ─────────────────────────────────────────────────────────────────────────────

function showFindStats(findStats) {
  $("found-count").textContent   = findStats.found;
  $("missing-count").textContent = findStats.missing;
  $("find-result").classList.remove("hidden");

  const skippedEl = $("skipped-metric");
  if (findStats.skipped > 0) {
    $("skipped-count").textContent = findStats.skipped;
    skippedEl.style.display = "";
  } else {
    skippedEl.style.display = "none";
  }

  if (findStats.missingTitles?.length) {
    $("missing-details").classList.remove("hidden");
    const ul = $("missing-list");
    ul.innerHTML = "";
    for (const t of findStats.missingTitles) {
      const li = document.createElement("li");
      li.textContent = t;
      ul.appendChild(li);
    }
  }
}

function showImportResults(r) {
  $("res-ok").textContent     = r.ok;
  $("res-already").textContent = r.already;
  $("res-fail").textContent   = r.fail;
  $("import-result").classList.remove("hidden");

  if (r.failedIds?.length) {
    $("failed-section").classList.remove("hidden");
    const ul = $("failed-list");
    ul.innerHTML = "";
    for (const fid of r.failedIds) {
      const li  = document.createElement("li");
      const url = `https://www.semanticscholar.org/paper/${fid}`;
      li.innerHTML = `<a href="${url}" target="_blank">${fid}</a>`;
      ul.appendChild(li);
    }
  }
}

function renderJobState(js) {
  setError("job-error", null);

  // ── Find section ──
  switch (js.status) {
    case "fetching":
      $("find-status").textContent = "Fetching papers from Zotero…";
      setProgress("find", 0, 1, "");
      break;
    case "finding":
      $("find-status").textContent = "Searching Semantic Scholar…";
      setProgress("find", js.findCurrent, js.findTotal, js.findLabel ?? "");
      break;
    default:
      // importing / done / error — find is complete
      $("find-status").textContent = "Search complete.";
      setProgress("find", js.findTotal ?? 1, js.findTotal ?? 1, "");
      if (js.findStats) showFindStats(js.findStats);

      // Reveal import section
      $("section-import").classList.remove("hidden");
  }

  // ── Import section ──
  if (js.status === "importing") {
    $("import-status").textContent =
      js.importFolderName ? `Importing "${js.importFolderName}"…` : "Importing…";
    setProgress("import", js.importCurrent ?? 0, js.importTotal ?? 1, js.importLabel ?? "");
  } else if (js.status === "done") {
    $("import-status").textContent = "Import complete!";
    setProgress("import", js.importTotal ?? 1, js.importTotal ?? 1, "");
    if (js.importResults) showImportResults(js.importResults);
    $("btn-done").classList.remove("hidden");
    $("btn-cancel").classList.add("hidden");
    // Show "Enable Research Feed" only when there are actual folders to update
    if (js.importedFolderIds?.length > 0) {
      $("btn-enable-feed").classList.remove("hidden");
    }
  } else if (js.status === "error") {
    const errMsg = js.error === "NOT_LOGGED_IN"
      ? "Not logged in to Semantic Scholar. Please log in, then try again."
      : js.error === "CREDENTIALS_MISSING"
      ? "Credentials not configured. Open Settings to set them up."
      : js.error ?? "An unknown error occurred.";
    $("import-status").textContent = "Import failed.";
    setError("job-error", errMsg);
    $("btn-done").textContent = "Start Over";
    $("btn-done").classList.remove("hidden");
    $("btn-cancel").classList.add("hidden");
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Polling
// ─────────────────────────────────────────────────────────────────────────────

let pollTimer = null;
const STALE_MS = 120000;

function startPolling() {
  if (pollTimer) return;
  pollTimer = setInterval(async () => {
    const { jobState } = await loadStorage(["jobState"]);

    if (!jobState) {
      // Job was cancelled or cleared
      stopPolling();
      resetPanel1();
      showPanel(0);
      return;
    }

    renderJobState(jobState);

    if (jobState.status === "done" || jobState.status === "error") {
      stopPolling();
      return;
    }

    // Stale check (background service worker was killed)
    if (["fetching", "finding", "importing"].includes(jobState.status)) {
      if (Date.now() - (jobState.updatedAt ?? 0) > STALE_MS) {
        stopPolling();
        setError("job-error",
          "The background job stopped responding (extension may have been restarted). " +
          "Click Start Over to try again."
        );
        $("btn-done").textContent = "Start Over";
        $("btn-done").classList.remove("hidden");
        $("btn-cancel").classList.add("hidden");
      }
    }
  }, 1000);
}

function stopPolling() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
}

function resetPanel1() {
  // Reset all job UI to initial state
  $("find-status").textContent  = "Starting…";
  $("import-status").textContent = "Waiting…";
  setProgress("find",   0, 1, "");
  setProgress("import", 0, 1, "");
  $("find-result").classList.add("hidden");
  $("skipped-metric").style.display = "none";
  $("missing-details").classList.add("hidden");
  $("section-import").classList.add("hidden");
  $("import-result").classList.add("hidden");
  $("failed-section").classList.add("hidden");
  setError("job-error", null);
  $("btn-done").textContent = "Done";
  $("btn-done").classList.add("hidden");
  $("btn-enable-feed").classList.add("hidden");
  $("btn-enable-feed").disabled = false;
  $("btn-enable-feed").textContent = "Enable Research Feed";
  $("btn-cancel").classList.remove("hidden");
}

// ─────────────────────────────────────────────────────────────────────────────
// Panel 0 — Collection picker
// ─────────────────────────────────────────────────────────────────────────────

function initPanel0() {
  $("btn-settings").addEventListener("click", () => chrome.runtime.openOptionsPage());
  $("btn-open-settings").addEventListener?.("click", () => chrome.runtime.openOptionsPage());
  $("btn-refresh-collections").addEventListener("click", async () => {
    const saved = await loadStorage(["zoteroId", "zoteroKey"]);
    if (saved.zoteroId && saved.zoteroKey) {
      fetchAndMountCollections(saved.zoteroId, saved.zoteroKey);
    }
  });

  $("btn-start-job").addEventListener("click", async () => {
    const selectedKeys = getSelectedKeys();
    if (!selectedKeys.length) return;

    // Transition to panel 1 immediately
    resetPanel1();
    showPanel(1);
    $("find-status").textContent = "Fetching papers from Zotero…";

    // Fire START_JOB — don't await (job runs entirely in background)
    chrome.runtime.sendMessage({
      type:           "START_JOB",
      collectionKeys: selectedKeys,
    }).catch(() => {});

    // Start polling storage for progress
    startPolling();
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Panel 1 — Find & Import
// ─────────────────────────────────────────────────────────────────────────────

function initPanel1() {
  $("btn-cancel").addEventListener("click", async () => {
    $("btn-cancel").disabled = true;
    $("btn-cancel").textContent = "Cancelling…";
    chrome.runtime.sendMessage({ type: "CANCEL_JOB" }).catch(() => {});
    // Poll will detect jobState disappearing and go back to panel 0
  });

  function finishAndReset() {
    clearJobState();
    stopPolling();
    resetPanel1();
    document.querySelectorAll(".tree-cb").forEach(cb => {
      cb.checked = false;
      cb.indeterminate = false;
    });
    updateStartButton();
    showPanel(0);
  }

  $("btn-done").addEventListener("click", finishAndReset);

  $("btn-enable-feed").addEventListener("click", async () => {
    const btn = $("btn-enable-feed");
    btn.disabled = true;
    btn.textContent = "Enabling…";

    const { jobState } = await loadStorage(["jobState"]);
    const folderIds = jobState?.importedFolderIds ?? [];
    if (folderIds.length > 0) {
      await chrome.runtime.sendMessage({ type: "ENABLE_RECOMMENDATION", folderIds }).catch(() => {});
    }
    finishAndReset();
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Init
// ─────────────────────────────────────────────────────────────────────────────

(async () => {
  initPanel0();
  initPanel1();

  const saved = await loadStorage(["zoteroId", "zoteroKey", "s2Key", "collections", "jobState", "watchedCollections"]);
  cachedWatched = saved.watchedCollections ?? {};

  // ── If a job is active, go straight to panel 1 ──────────────────────────
  if (saved.jobState && saved.jobState.status !== "cancelled") {
    if (saved.collections?.length) {
      mountTree(saved.collections, cachedWatched);
    }
    showPanel(1);
    renderJobState(saved.jobState);
    if (!["done", "error"].includes(saved.jobState.status)) {
      startPolling();
    }
    return;
  }

  // ── No active job — show collection picker ───────────────────────────────
  if (!saved.zoteroId || !saved.zoteroKey) {
    // No credentials set
    $("no-creds-notice").classList.remove("hidden");
    $("btn-open-settings").addEventListener("click", () => chrome.runtime.openOptionsPage());
    showPanel(0);
    return;
  }

  showPanel(0);

  if (saved.collections?.length) {
    mountTree(saved.collections, cachedWatched);
    chrome.runtime.sendMessage({
      type: "GET_COLLECTIONS",
      libraryId: saved.zoteroId,
      apiKey: saved.zoteroKey,
    }).then(res => {
      if (!res.error && res.collections?.length) {
        chrome.storage.local.set({ collections: res.collections });
        mountTree(res.collections, cachedWatched);
      }
    }).catch(() => {});
  } else {
    // No cache — fetch fresh
    fetchAndMountCollections(saved.zoteroId, saved.zoteroKey);
  }
})();
