// options.js

const $ = id => document.getElementById(id);

const S2_PUBLIC = "https://api.semanticscholar.org/graph/v1";
const ZOTERO_BASE = "https://api.zotero.org";

// ── Load saved values ─────────────────────────────────────────────────────────

chrome.storage.local.get(["zoteroId", "zoteroKey", "s2Key"], items => {
  if (items.zoteroId)  $("zotero-id").value  = items.zoteroId;
  if (items.zoteroKey) $("zotero-key").value = items.zoteroKey;
  if (items.s2Key)     $("s2-key").value     = items.s2Key;
});

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
