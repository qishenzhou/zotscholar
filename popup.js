// popup.js — UI logic

// ─────────────────────────────────────────────────────────────────────────────
// State
// ─────────────────────────────────────────────────────────────────────────────

const state = {
  step:        0,
  zoteroId:    "",
  zoteroKey:   "",
  s2Key:       "",
  collections: [],
  groups:      [],  // [{key, name, found:[{id,title}], missing:[]}] after resolve
};

// ─────────────────────────────────────────────────────────────────────────────
// DOM refs
// ─────────────────────────────────────────────────────────────────────────────

const $ = id => document.getElementById(id);

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function showPanel(n) {
  for (let i = 0; i < 4; i++) {
    $(`panel-${i}`).classList.toggle("hidden", i !== n);
    const stepEl = document.querySelector(`.step[data-step="${i}"]`);
    stepEl.classList.remove("active", "done");
    if (i < n)  stepEl.classList.add("done");
    if (i === n) stepEl.classList.add("active");
  }
  state.step = n;
}

function setError(id, msg) {
  const el = $(id);
  if (msg) { el.textContent = msg; el.classList.remove("hidden"); }
  else       el.classList.add("hidden");
}

function setProgress(phase, current, total, label) {
  const pct = total > 0 ? Math.round(current / total * 100) : 0;
  $(`${phase}-bar`).style.width = `${pct}%`;
  $(`${phase}-label`).textContent = label ?? "";
}

async function sendBg(msg) {
  return chrome.runtime.sendMessage(msg);
}

function loadStorage() {
  return new Promise(resolve => {
    chrome.storage.local.get(
      ["zoteroId","zoteroKey","s2Key","pendingImport","importState","collections","resolveState"],
      items => resolve(items)
    );
  });
}

function saveStorage(data) {
  chrome.storage.local.set(data);
}

function clearPendingImport() { chrome.storage.local.remove("pendingImport"); }
function clearImportState()   { chrome.storage.local.remove("importState"); }
function clearResolveState()  { chrome.storage.local.remove("resolveState"); }

function displayImportResults(r) {
  clearPendingImport();
  setProgress("import", 1, 1, "");
  $("import-status").textContent = "Import complete!";
  $("res-ok").textContent      = r.ok;
  $("res-already").textContent = r.already;
  $("res-fail").textContent    = r.fail;
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

// ─────────────────────────────────────────────────────────────────────────────
// Polling — resolve
// ─────────────────────────────────────────────────────────────────────────────

function pollResolveState() {
  const POLL_MS  = 1000;
  const STALE_MS = 120000;

  const timer = setInterval(async () => {
    const { resolveState, pendingImport } = await new Promise(r =>
      chrome.storage.local.get(["resolveState", "pendingImport"], r)
    );

    if (!resolveState || resolveState.status !== "running") {
      clearInterval(timer);
      clearResolveState();
      if (pendingImport?.groups?.length) {
        state.groups = pendingImport.groups;
        showResolveResults(pendingImport.groups);
      } else {
        $("resolve-status").textContent = "No papers found on Semantic Scholar.";
      }
      return;
    }

    if (Date.now() - (resolveState.updatedAt ?? 0) > STALE_MS) {
      clearInterval(timer);
      clearResolveState();
      $("resolve-status").textContent = "Search was interrupted. Go back and try again.";
      return;
    }

    setProgress("resolve", resolveState.current, resolveState.total, resolveState.label ?? "");
  }, POLL_MS);
}

// ─────────────────────────────────────────────────────────────────────────────
// Polling — import
// ─────────────────────────────────────────────────────────────────────────────

function pollImportState() {
  const POLL_MS    = 1000;
  const STALE_MS   = 60000;

  const timer = setInterval(async () => {
    const { importState } = await new Promise(r =>
      chrome.storage.local.get("importState", r)
    );

    if (!importState || importState.status !== "running") {
      clearInterval(timer);
      if (importState?.status === "done") {
        displayImportResults(importState.results);
      } else if (importState?.status === "error") {
        $("import-status").textContent = "Import failed.";
        setError("import-error", importState.error ?? "Unknown error");
        $("btn-retry-import").classList.remove("hidden");
      }
      return;
    }

    if (Date.now() - (importState.updatedAt ?? 0) > STALE_MS) {
      clearInterval(timer);
      clearImportState();
      $("import-status").textContent = "Import was interrupted (extension restarted?).";
      setError("import-error",
        "Background import stopped responding. Click Retry Import to try again."
      );
      $("btn-retry-import").classList.remove("hidden");
      return;
    }

    setProgress("import", importState.current, importState.total, importState.label);
    if (importState.folderName) {
      $("import-status").textContent = `Importing "${importState.folderName}"…`;
    }
  }, POLL_MS);
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 0 — Credentials
// ─────────────────────────────────────────────────────────────────────────────

async function initStep0() {
  const saved = await loadStorage();
  if (saved.zoteroId)  $("zotero-id").value  = saved.zoteroId;
  if (saved.zoteroKey) $("zotero-key").value = saved.zoteroKey;
  if (saved.s2Key)     $("s2-key").value     = saved.s2Key;

  const { loggedIn } = await sendBg({ type: "CHECK_S2_LOGIN" });
  const dot  = $("s2-status-dot");
  const text = $("s2-status-text");
  if (loggedIn) {
    dot.className = "dot ok";
    text.textContent = "Logged in to Semantic Scholar ✓";
  } else {
    dot.className = "dot error";
    text.innerHTML =
      'Not logged in to Semantic Scholar — ' +
      '<a href="https://www.semanticscholar.org/sign-in" target="_blank" ' +
      'style="color:#1a1a6e">Log in →</a> then reopen this popup.';
  }

  $("btn-verify").addEventListener("click", onVerify);
  $("btn-test-s2-key").addEventListener("click", onTestS2Key);
}

async function onTestS2Key() {
  const s2Key = $("s2-key").value.trim();
  const btn = $("btn-test-s2-key");
  const status = $("s2-key-status");

  if (!s2Key) {
    status.textContent = "Please enter an API key first.";
    status.className = "hint error-text";
    status.classList.remove("hidden");
    return;
  }

  btn.disabled = true;
  btn.textContent = "…";
  status.classList.add("hidden");

  const res = await sendBg({ type: "CHECK_S2_KEY", s2ApiKey: s2Key });

  if (res.valid) {
    status.textContent = res.reason === "rate_limited"
      ? "✓ Key is valid (rate limited right now, will work)"
      : "✓ Key is valid";
    status.className = "hint ok-text";
  } else {
    const msg = res.reason === "unauthorized"
      ? "✗ Key is invalid (unauthorized)"
      : res.reason === "empty"
      ? "✗ No key entered"
      : `✗ Test failed: ${res.reason}`;
    status.textContent = msg;
    status.className = "hint error-text";
  }
  status.classList.remove("hidden");

  btn.disabled = false;
  btn.textContent = "Test";
}

async function onVerify() {
  const libraryId = $("zotero-id").value.trim();
  const apiKey    = $("zotero-key").value.trim();
  const s2Key     = $("s2-key").value.trim();

  if (!libraryId || !apiKey) {
    setError("cred-error", "Please enter your Zotero Library ID and API key.");
    return;
  }

  const btn = $("btn-verify");
  btn.disabled    = true;
  btn.textContent = "Verifying…";
  setError("cred-error", null);

  try {
    const res = await sendBg({ type: "GET_COLLECTIONS", libraryId, apiKey });
    if (res.error) throw new Error(res.error);

    state.zoteroId    = libraryId;
    state.zoteroKey   = apiKey;
    state.s2Key       = s2Key;
    state.collections = res.collections;
    saveStorage({ zoteroId: libraryId, zoteroKey: apiKey, s2Key, collections: res.collections });

    mountTree(res.collections);
    showPanel(1);
  } catch (err) {
    setError("cred-error", `Zotero connection failed: ${err.message}`);
  } finally {
    btn.disabled    = false;
    btn.textContent = "Verify & Continue →";
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 1 — Collection tree
// ─────────────────────────────────────────────────────────────────────────────

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
  cb.className        = "tree-cb";
  cb.dataset.key      = node.key;
  cb.dataset.parentKey = parentKey ?? "";

  const lbl = document.createElement("label");
  lbl.htmlFor   = `cb-${node.key}`;
  lbl.className = "tree-label";
  lbl.title     = `${node.name} — ${node.count} direct item(s)`;
  lbl.textContent = `${node.name}  (${node.count})`;

  row.append(toggle, cb, lbl);
  item.appendChild(row);

  let childrenDiv = null;
  if (node.children.length) {
    childrenDiv = document.createElement("div");
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
    // Cascade to all descendants
    item.querySelectorAll(".tree-cb").forEach(c => {
      c.checked = cb.checked;
      c.indeterminate = false;
    });
    // Propagate indeterminate state up
    updateAncestors(cb.dataset.parentKey);
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
  const checkedCount = childCbs.filter(c => c.checked && !c.indeterminate).length;
  const indeterCount = childCbs.filter(c => c.indeterminate).length;

  if (checkedCount === childCbs.length && indeterCount === 0) {
    parentCb.checked = true;
    parentCb.indeterminate = false;
  } else if (checkedCount === 0 && indeterCount === 0) {
    parentCb.checked = false;
    parentCb.indeterminate = false;
  } else {
    parentCb.checked = false;
    parentCb.indeterminate = true;
  }

  updateAncestors(parentCb.dataset.parentKey);
}

function mountTree(collections) {
  const container = $("collection-tree");
  container.innerHTML = "";
  const roots = buildTree(collections);
  for (const root of roots) container.appendChild(renderTreeNode(root, ""));
}

function getSelectedKeys() {
  return Array.from(document.querySelectorAll(".tree-cb:checked")).map(cb => cb.dataset.key);
}

function initStep1() {
  $("btn-back-0").addEventListener("click", () => showPanel(0));
  $("btn-load-papers").addEventListener("click", onLoadPapers);
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 2 — Find Papers
// ─────────────────────────────────────────────────────────────────────────────

function showResolveResults(groups) {
  const foundTotal   = groups.reduce((s, g) => s + g.found.length, 0);
  const missingTotal = groups.reduce((s, g) => s + g.missing.length, 0);
  const allMissing   = groups.flatMap(g => g.missing);
  const foldersWithPapers = groups.filter(g => g.found.length).length;

  setProgress("resolve", 1, 1, "");
  $("resolve-status").textContent =
    `Search complete! ${foldersWithPapers} S2 folder(s) will be created.`;
  $("found-count").textContent   = foundTotal;
  $("missing-count").textContent = missingTotal;
  $("resolve-result").classList.remove("hidden");

  if (allMissing.length) {
    $("missing-details").classList.remove("hidden");
    const ul = $("missing-list");
    ul.innerHTML = "";
    for (const t of allMissing) {
      const li = document.createElement("li");
      li.textContent = t;
      ul.appendChild(li);
    }
  }

  if (foundTotal) $("btn-start-import").classList.remove("hidden");
}

async function onLoadPapers() {
  const selectedKeys = getSelectedKeys();
  if (!selectedKeys.length) return;

  showPanel(2);
  $("resolve-status").textContent = "Fetching papers from Zotero…";
  setProgress("resolve", 0, 1, "");

  const papersRes = await sendBg({
    type:           "GET_PAPERS",
    libraryId:      state.zoteroId,
    apiKey:         state.zoteroKey,
    collectionKeys: selectedKeys,
    allCollections: state.collections,
  });

  if (papersRes.error) {
    $("resolve-status").textContent = "Error fetching papers.";
    return;
  }

  const groups = papersRes.groups ?? [];
  if (!groups.length) {
    $("resolve-status").textContent = "No papers found in selected collections.";
    return;
  }

  const totalPapers = groups.reduce((s, g) => s + g.papers.length, 0);
  $("resolve-status").textContent =
    `Searching S2 for ${totalPapers} papers across ${groups.length} folder(s)…`;
  setProgress("resolve", 0, totalPapers, "Starting…");

  const progressHandler = msg => {
    if (msg.type !== "PROGRESS" || msg.phase !== "resolve") return;
    setProgress("resolve", msg.current, msg.total, msg.label);
  };
  chrome.runtime.onMessage.addListener(progressHandler);

  const res = await sendBg({
    type:     "RESOLVE_PAPERS",
    groups,
    s2ApiKey: state.s2Key || null,
  });

  chrome.runtime.onMessage.removeListener(progressHandler);
  clearResolveState();

  if (res.error) {
    $("resolve-status").textContent = `Error: ${res.error}`;
    return;
  }

  state.groups = res.groups;
  showResolveResults(res.groups);
}

function initStep2() {
  $("btn-back-1").addEventListener("click", () => {
    clearResolveState();
    showPanel(1);
    $("resolve-result").classList.add("hidden");
    $("missing-details").classList.add("hidden");
    $("btn-start-import").classList.add("hidden");
    setProgress("resolve", 0, 1, "");
  });

  $("btn-start-import").addEventListener("click", onImport);
  $("btn-retry-import").addEventListener("click", () => {
    $("btn-retry-import").classList.add("hidden");
    setError("import-error", null);
    onImport();
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 3 — Import
// ─────────────────────────────────────────────────────────────────────────────

async function onImport() {
  clearImportState();
  showPanel(3);
  $("btn-retry-import").classList.add("hidden");
  $("import-result").classList.add("hidden");
  $("failed-section").classList.add("hidden");
  setError("import-error", null);

  const totalFound        = state.groups.reduce((s, g) => s + g.found.length, 0);
  const foldersWithPapers = state.groups.filter(g => g.found.length).length;
  $("import-status").textContent =
    `Importing ${totalFound} papers into ${foldersWithPapers} S2 folder(s)…`;
  setProgress("import", 0, 1, "Connecting to Semantic Scholar…");

  const progressHandler = msg => {
    if (msg.type !== "PROGRESS" || msg.phase !== "import") return;
    setProgress("import", msg.current, msg.total, msg.label);
  };
  chrome.runtime.onMessage.addListener(progressHandler);

  pollImportState();

  const res = await sendBg({
    type:   "IMPORT_PAPERS",
    groups: state.groups,
  });

  chrome.runtime.onMessage.removeListener(progressHandler);

  if (res.error) {
    $("import-status").textContent = "Import failed.";
    clearImportState();
    if (res.error === "NO_S2_TAB") {
      setError("import-error",
        "Please open semanticscholar.org in a browser tab first, then click Retry Import."
      );
    } else if (res.error === "NOT_LOGGED_IN") {
      setError("import-error",
        "Not logged in to Semantic Scholar. Please log in and click Retry Import."
      );
    } else if (res.error.includes("Content script did not respond")) {
      setError("import-error",
        "Could not connect to Semantic Scholar tab. Wait for it to load, then click Retry Import."
      );
    } else {
      setError("import-error", `Error: ${res.error}`);
    }
    $("btn-retry-import").classList.remove("hidden");
    return;
  }

  displayImportResults(res);
}

// ─────────────────────────────────────────────────────────────────────────────
// Restart
// ─────────────────────────────────────────────────────────────────────────────

function initRestart() {
  $("btn-restart").addEventListener("click", () => {
    clearPendingImport();
    clearImportState();
    state.groups = [];
    document.querySelectorAll(".tree-cb").forEach(cb => {
      cb.checked = false;
      cb.indeterminate = false;
    });
    $("resolve-result").classList.add("hidden");
    $("missing-details").classList.add("hidden");
    $("btn-start-import").classList.add("hidden");
    $("import-result").classList.add("hidden");
    $("failed-section").classList.add("hidden");
    setError("import-error", null);
    setProgress("resolve", 0, 1, "");
    setProgress("import",  0, 1, "");
    showPanel(1);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Init
// ─────────────────────────────────────────────────────────────────────────────

(async () => {
  await initStep0();
  initStep1();
  initStep2();
  initRestart();

  const saved = await loadStorage();

  function restoreCollections() {
    if (saved.collections?.length) {
      state.zoteroId    = saved.zoteroId    ?? "";
      state.zoteroKey   = saved.zoteroKey   ?? "";
      state.s2Key       = saved.s2Key       ?? "";
      state.collections = saved.collections;
      mountTree(saved.collections);
    }
  }

  if (saved.importState?.status === "running") {
    restoreCollections();
    showPanel(3);
    $("import-status").textContent =
      `Import running… (${saved.importState.current ?? 0}/${saved.importState.total ?? "?"})`;
    setProgress("import",
      saved.importState.current ?? 0,
      saved.importState.total ?? 1,
      saved.importState.label ?? ""
    );
    pollImportState();
  } else if (saved.importState?.status === "done") {
    restoreCollections();
    showPanel(3);
    displayImportResults(saved.importState.results);
    clearImportState();
  } else if (saved.pendingImport?.groups?.length) {
    state.groups = saved.pendingImport.groups;
    restoreCollections();
    clearResolveState();
    showPanel(2);
    showResolveResults(saved.pendingImport.groups);
    $("resolve-status").textContent =
      `Search complete! (restored) — ${saved.pendingImport.groups.filter(g => g.found.length).length} S2 folder(s) ready.`;
  } else if (saved.resolveState?.status === "running") {
    restoreCollections();
    showPanel(2);
    $("resolve-status").textContent = "Finding papers… (resumed)";
    setProgress("resolve",
      saved.resolveState.current ?? 0,
      saved.resolveState.total ?? 1,
      saved.resolveState.label ?? ""
    );
    pollResolveState();
  } else if (saved.zoteroId && saved.zoteroKey && saved.collections?.length) {
    restoreCollections();
    showPanel(1);
  } else {
    showPanel(0);
  }
})();
