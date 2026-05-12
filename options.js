// options.js

const $ = id => document.getElementById(id);

const S2_PUBLIC = "https://api.semanticscholar.org/graph/v1";
const ZOTERO_BASE = "https://api.zotero.org";

// ── Load saved values ─────────────────────────────────────────────────────────

chrome.storage.local.get(
  ["zoteroId", "zoteroKey", "s2Key", "syncInterval", "watchedCollections", "lastAutoSync"],
  items => {
    if (items.zoteroId)  $("zotero-id").value  = items.zoteroId;
    if (items.zoteroKey) $("zotero-key").value = items.zoteroKey;
    if (items.s2Key)     $("s2-key").value     = items.s2Key;
    $("sync-interval").value = String(items.syncInterval ?? 0);
    renderWatchedList(items.watchedCollections ?? {});
    renderLastAutoSync(items.lastAutoSync);
  }
);

// ── S2 login status ───────────────────────────────────────────────────────────

async function checkS2Login() {
  const tabs = await chrome.tabs.query({ url: "https://www.semanticscholar.org/*" });
  for (const tab of tabs) {
    try {
      const res = await chrome.tabs.sendMessage(tab.id, { type: "S2_OP", op: "CHECK_LOGIN" });
      if (typeof res?.loggedIn === "boolean") return res.loggedIn;
    } catch {}
  }
  const cookies = await chrome.cookies.getAll({ url: "https://www.semanticscholar.org/" });
  const ANALYTICS = /^(_ga|_gid|_gat|amp_|ajs_|anon_|intercom)/;
  return cookies.some(c => c.value.length > 50 && !ANALYTICS.test(c.name));
}

(async () => {
  const loggedIn = await checkS2Login();
  const dot  = $("s2-dot");
  const text = $("s2-login-text");
  if (loggedIn) {
    dot.className = "dot ok";
    text.textContent = "Logged in to Semantic Scholar ✓";
  } else {
    dot.className = "dot error";
    text.innerHTML =
      'Not logged in — ' +
      '<a href="https://www.semanticscholar.org/sign-in" target="_blank">Log in →</a>' +
      ' then return here.';
  }
})();

// ── Test Zotero ───────────────────────────────────────────────────────────────

$("btn-test-zotero").addEventListener("click", async () => {
  const id  = $("zotero-id").value.trim();
  const key = $("zotero-key").value.trim();
  const btn = $("btn-test-zotero");
  const status = $("zotero-status");

  if (!id || !key) {
    status.textContent = "Please enter both Library ID and API Key.";
    status.className = "msg error";
    status.classList.remove("hidden");
    return;
  }

  btn.disabled = true;
  btn.textContent = "…";
  status.classList.add("hidden");

  try {
    const r = await fetch(`${ZOTERO_BASE}/users/${id}/collections?limit=1`, {
      headers: { "Zotero-API-Key": key, "Zotero-API-Version": "3" },
    });
    if (r.ok) {
      const total = r.headers.get("Total-Results");
      status.textContent = `✓ Connected — ${total ?? "?"} collection(s) found`;
      status.className = "msg ok";
    } else if (r.status === 403) {
      status.textContent = "✗ Invalid API key or Library ID";
      status.className = "msg error";
    } else {
      status.textContent = `✗ HTTP ${r.status}`;
      status.className = "msg error";
    }
  } catch (e) {
    status.textContent = `✗ ${e.message}`;
    status.className = "msg error";
  }

  status.classList.remove("hidden");
  btn.disabled = false;
  btn.textContent = "Test";
});

// ── Test S2 API key ───────────────────────────────────────────────────────────

$("btn-test-s2-key").addEventListener("click", async () => {
  const key = $("s2-key").value.trim();
  const btn = $("btn-test-s2-key");
  const status = $("s2-key-status");

  if (!key) {
    status.textContent = "Please enter a key first.";
    status.className = "msg error";
    status.classList.remove("hidden");
    return;
  }

  btn.disabled = true;
  btn.textContent = "…";
  status.classList.add("hidden");

  try {
    const r = await fetch(
      `${S2_PUBLIC}/paper/search?query=deep+learning&fields=paperId&limit=1`,
      { headers: { "x-api-key": key } }
    );
    if (r.ok) {
      status.textContent = "✓ Key is valid";
      status.className = "msg ok";
    } else if (r.status === 429) {
      status.textContent = "✓ Key is valid (rate limited right now)";
      status.className = "msg ok";
    } else if (r.status === 401 || r.status === 403) {
      status.textContent = "✗ Key is invalid";
      status.className = "msg error";
    } else {
      status.textContent = `✗ HTTP ${r.status}`;
      status.className = "msg error";
    }
  } catch (e) {
    status.textContent = `✗ ${e.message}`;
    status.className = "msg error";
  }

  status.classList.remove("hidden");
  btn.disabled = false;
  btn.textContent = "Test";
});

// ── Auto-sync interval ────────────────────────────────────────────────────────

$("sync-interval").addEventListener("change", async () => {
  const minutes = parseInt($("sync-interval").value, 10);
  await chrome.storage.local.set({ syncInterval: minutes });
  chrome.runtime.sendMessage({ type: "SET_SYNC_INTERVAL", minutes }).catch(() => {});
});

$("btn-sync-now").addEventListener("click", async () => {
  const btn = $("btn-sync-now");
  const status = $("sync-now-status");
  btn.disabled = true;
  btn.textContent = "Syncing…";
  status.classList.add("hidden");
  try {
    const res = await chrome.runtime.sendMessage({ type: "AUTO_SYNC" });
    if (res?.error) throw new Error(res.error);
    const added = res?.importResults?.ok ?? 0;
    const skipped = res?.findStats?.skipped ?? 0;
    status.textContent = `✓ Done — ${added} new, ${skipped} skipped`;
    status.className = "msg ok";
    // Refresh watched list
    const { watchedCollections, lastAutoSync } = await chrome.storage.local.get(["watchedCollections", "lastAutoSync"]);
    renderWatchedList(watchedCollections ?? {});
    renderLastAutoSync(lastAutoSync);
  } catch (e) {
    status.textContent = `✗ ${e.message}`;
    status.className = "msg error";
  }
  status.classList.remove("hidden");
  btn.disabled = false;
  btn.textContent = "Sync Now";
});

function renderWatchedList(watchedCollections) {
  const container = $("watched-list");
  const keys = Object.keys(watchedCollections);
  if (!keys.length) {
    container.innerHTML = '<span style="color:#9ca3af;font-size:12px">No collections watched yet.</span>';
    return;
  }
  container.innerHTML = "";

  for (const key of keys) {
    const w = watchedCollections[key];

    const card = document.createElement("div");
    card.className = "watched-card";

    // Top row: name + meta
    const cardTop = document.createElement("div");
    cardTop.className = "watched-card-top";

    const info = document.createElement("div");
    info.className = "watched-info";
    const nameEl = document.createElement("strong");
    nameEl.textContent = w.name;
    const meta = document.createElement("span");
    meta.className = "watched-meta";
    const count = w.syncedItemKeys?.length ?? 0;
    const ts = w.lastSyncAt ? new Date(w.lastSyncAt).toLocaleString() : "Never";
    meta.textContent = `${count} papers · Last sync: ${ts}`;
    info.append(nameEl, meta);
    cardTop.append(info);

    // Bottom row: Feed toggle + Remove
    const cardBottom = document.createElement("div");
    cardBottom.className = "watched-card-bottom";

    // Toggle switch
    const switchId = `feed-${key}`;
    const switchLabel = document.createElement("label");
    switchLabel.className = "feed-switch loading";
    switchLabel.htmlFor = switchId;

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.id = switchId;
    checkbox.dataset.folderId = w.s2FolderId ?? "";
    checkbox.dataset.currentStatus = "";

    const slider = document.createElement("span");
    slider.className = "feed-slider";

    const feedText = document.createElement("span");
    feedText.className = "feed-label";
    feedText.textContent = "Feed";

    switchLabel.append(feedText, checkbox, slider);

    checkbox.addEventListener("change", async () => {
      if (!checkbox.dataset.folderId || switchLabel.classList.contains("loading")) {
        checkbox.checked = checkbox.dataset.currentStatus === "On";
        return;
      }
      const newStatus = checkbox.checked ? "On" : "Off";
      switchLabel.classList.add("loading");
      checkbox.disabled = true;
      try {
        await chrome.runtime.sendMessage({
          type: "TOGGLE_RECOMMENDATION",
          folderId: checkbox.dataset.folderId,
          status: newStatus,
        });
        setFeedToggleState(switchLabel, checkbox, newStatus);
      } catch {
        setFeedToggleState(switchLabel, checkbox, checkbox.dataset.currentStatus);
      }
      checkbox.disabled = false;
    });

    // Remove button
    const removeBtn = document.createElement("button");
    removeBtn.textContent = "Remove";
    removeBtn.className = "btn-remove";
    removeBtn.addEventListener("click", async () => {
      const { watchedCollections: cur = {} } = await chrome.storage.local.get("watchedCollections");
      delete cur[key];
      await chrome.storage.local.set({ watchedCollections: cur });
      card.remove();
      if (!Object.keys(cur).length) {
        container.innerHTML = '<span style="color:#9ca3af;font-size:12px">No collections watched yet.</span>';
      }
    });

    cardBottom.append(switchLabel, removeBtn);
    card.append(cardTop, cardBottom);
    container.appendChild(card);
  }

  // Async: fetch real Research Feed statuses and populate toggles
  chrome.runtime.sendMessage({ type: "GET_FOLDERS_STATUS" }).then(res => {
    if (!res?.folders) return;
    const statusMap = Object.fromEntries(res.folders.map(f => [f.id, f.recommendationStatus]));
    container.querySelectorAll("input[data-folder-id]").forEach(checkbox => {
      const status = statusMap[checkbox.dataset.folderId];
      if (status !== undefined) {
        const switchLabel = checkbox.closest(".feed-switch");
        setFeedToggleState(switchLabel, checkbox, status);
      }
    });
  }).catch(() => {});
}

function setFeedToggleState(switchLabel, checkbox, status) {
  const s = typeof status === "string" ? status : (status?.id ?? "Off");
  checkbox.dataset.currentStatus = s;
  checkbox.checked = s === "On";
  switchLabel.classList.remove("loading");
}

// ── Detect existing S2 folders ────────────────────────────────────────────────

$("btn-detect").addEventListener("click", async () => {
  const btn    = $("btn-detect");
  const status = $("detect-status");
  btn.disabled = true;
  btn.textContent = "Detecting…";
  status.classList.add("hidden");
  try {
    const res = await chrome.runtime.sendMessage({ type: "DETECT_WATCHED" });
    if (res?.error) throw new Error(res.error);
    const n = res?.detected ?? 0;
    if (n === 0) {
      status.textContent = "No new matches found (S2 folder names must match Zotero collection names exactly).";
      status.className = "msg";
    } else {
      status.textContent = `✓ Registered ${n} collection${n > 1 ? "s" : ""} as watched.`;
      status.className = "msg ok";
      const { watchedCollections } = await chrome.storage.local.get("watchedCollections");
      renderWatchedList(watchedCollections ?? {});
    }
  } catch (e) {
    status.textContent = `✗ ${e.message}`;
    status.className = "msg error";
  }
  status.classList.remove("hidden");
  btn.disabled = false;
  btn.textContent = "Detect existing folders";
});

function renderLastAutoSync(lastAutoSync) {
  const el = $("last-auto-sync");
  if (!lastAutoSync || !el) return;
  const t = new Date(lastAutoSync.at).toLocaleString();
  if (lastAutoSync.status === "error") {
    el.textContent = `Last auto-sync: ${t} — Failed (${lastAutoSync.error})`;
    el.className = "msg error";
  } else {
    el.textContent = `Last auto-sync: ${t} — ${lastAutoSync.added} added, ${lastAutoSync.skipped} skipped, ${lastAutoSync.notFound} not found`;
    el.className = "msg ok";
  }
  el.classList.remove("hidden");
}

// ── Save ──────────────────────────────────────────────────────────────────────

$("btn-save").addEventListener("click", () => {
  const data = {
    zoteroId:  $("zotero-id").value.trim(),
    zoteroKey: $("zotero-key").value.trim(),
    s2Key:     $("s2-key").value.trim(),
  };

  const status = $("save-status");

  if (!data.zoteroId || !data.zoteroKey) {
    status.textContent = "Please enter Zotero Library ID and API Key.";
    status.className = "error";
    status.classList.remove("hidden");
    return;
  }

  // Also clear cached collections so popup re-fetches with new credentials
  chrome.storage.local.set({ ...data, collections: null }, () => {
    status.textContent = "Settings saved ✓";
    status.className = "ok";
    status.classList.remove("hidden");
    setTimeout(() => status.classList.add("hidden"), 3000);
  });
});
