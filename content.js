// content.js — injected into https://www.semanticscholar.org/*
//
// Guard: if this file is injected more than once (e.g., both via manifest
// and via executeScript fallback), only the first execution sets up listeners.
if (window.__s2ZoteroExtLoaded) {
  // already running — do nothing
} else {
  window.__s2ZoteroExtLoaded = true;

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === "PING") {
      sendResponse({ pong: true });
      return;
    }
    if (msg.type !== "S2_OP") return;
    handleOp(msg)
      .then(sendResponse)
      .catch(e => sendResponse({ error: e.message ?? String(e) }));
    return true; // async response
  });

  // ── CSRF (next-auth stores it in a JS-readable cookie) ──────────────────
  function getCsrf() {
    const m = document.cookie.match(
      /(?:^|;\s*)(?:__Host-)?next-auth\.csrf-token=([^;]+)/
    );
    return m ? decodeURIComponent(m[1]).split("|")[0] : "";
  }

  function jsonHeaders() {
    return { "Content-Type": "application/json", "x-csrf-token": getCsrf() };
  }

  // ── Operations ─────────────────────────────────────────────────────────
  async function handleOp(msg) {
    switch (msg.op) {

      case "CHECK_LOGIN": {
        // Method 1: read Next.js page data (no network request, instant)
        try {
          const nd = window.__NEXT_DATA__;
          // S2 stores the viewer/user in various places depending on page version
          const user =
            nd?.props?.pageProps?.sessionProps?.viewer ||
            nd?.props?.pageProps?.session?.user ||
            nd?.props?.initialProps?.pageProps?.viewer;
          if (user) return { loggedIn: true, method: "nextData" };
        } catch {}

        // Method 2: DOM — "Sign In" button visible only when logged OUT
        const signInLink = document.querySelector(
          'a[href*="/sign-in"], a[href*="/login"], [data-test-id*="sign-in"]'
        );
        if (signInLink) return { loggedIn: false, method: "dom" };

        // Method 3: library API call
        try {
          const r = await fetch("/api/1/library/folders", { credentials: "include" });
          return { loggedIn: r.ok, status: r.status, method: "api" };
        } catch (e) {
          return { loggedIn: false, error: e.message };
        }
      }

      case "GET_OR_CREATE_FOLDER": {
        const r = await fetch("/api/1/library/folders", {
          credentials: "include",
          headers: jsonHeaders(),
        });
        if (r.status === 401 || r.status === 403) throw new Error("NOT_LOGGED_IN");
        if (!r.ok) throw new Error(`folder list HTTP ${r.status}`);

        const body = await r.json();
        const list = Array.isArray(body) ? body : (body.folders ?? body.data ?? []);
        const hit  = list.find(
          f => (f.name ?? "").toLowerCase() === msg.folderName.toLowerCase()
        );
        if (hit) {
          const id = hit.id ?? hit.folderId ?? hit.folder_id;
          if (id != null) return { folderId: String(id) };
        }

        const r2 = await fetch("/api/1/library/folders", {
          method: "POST",
          credentials: "include",
          headers: jsonHeaders(),
          body: JSON.stringify({ name: msg.folderName }),
        });
        if (!r2.ok) throw new Error(`create folder HTTP ${r2.status}: ${await r2.text()}`);
        const d = await r2.json();
        const newId = d.id ?? d.folderId ?? d.folder?.id ?? d.data?.id ?? d.data?.folderId;
        if (newId == null) throw new Error(`folder create: unexpected response shape: ${JSON.stringify(d)}`);
        return { folderId: String(newId) };
      }

      case "ADD_PAPER": {
        const h = { "Content-Type": "application/json" };

        // S2's real API requires paperId, paperTitle, sourceType, folderIds
        const body = {
          paperId:         msg.paperId,
          paperTitle:      msg.paperTitle || "",
          sourceType:      "Library",
          folderIds:       [Number(msg.folderId)],
          annotationState: null,
        };
        const r = await fetch("/api/1/library/folders/entries/bulk", {
          method: "POST",
          credentials: "include",
          headers: h,
          body: JSON.stringify(body),
        });

        if (r.ok)             return { result: "ok" };
        if (r.status === 409) return { result: "already" };

        // Return response body for debugging unexpected formats
        const text = await r.text().catch(() => "");
        return { result: "error", status: r.status, step: "bulk", detail: text.slice(0, 200) };
      }

      case "SEARCH_PAPER": {
        // Search via S2's internal API (same-origin, no separate rate limit)
        try {
          const url = `/api/1/paper/search?q=${encodeURIComponent(msg.query)}&limit=10`;
          const r = await fetch(url, { credentials: "include" });
          if (!r.ok) return { papers: [] };
          const body = await r.json();
          const raw = body.data ?? body.results ?? body.papers ?? [];
          const papers = raw.map(p => ({
            paperId: p.paperId ?? p.id ?? "",
            title:   p.title ?? "",
          })).filter(p => p.paperId);
          return { papers };
        } catch {
          return { papers: [] };
        }
      }

      default:
        throw new Error(`Unknown S2 op: ${msg.op}`);
    }
  }
}
