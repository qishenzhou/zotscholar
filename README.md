# ZotScholar

> A Chrome extension that keeps your Semantic Scholar Library in sync with Zotero — automatically.

ZotScholar imports your Zotero collections into Semantic Scholar, preserving folder structure so S2 can generate **daily paper recommendations** for each topic. New papers added to Zotero are picked up incrementally in the background.

---

## Installation

1. **Download** this repository (Code → Download ZIP, then unzip), or clone it:
   ```
   git clone https://github.com/qishenzhou/zotscholar.git
   ```
2. Open Chrome and navigate to `chrome://extensions`
3. Enable **Developer mode** (toggle in the top-right corner)
4. Click **Load unpacked** and select the `zotscholar` folder
5. The ZotScholar icon appears in your Chrome toolbar

---

## Setup

Open the extension settings by clicking the toolbar icon → **⚙ Settings**, or right-clicking the icon → **Options**.

### 1. Zotero credentials

| Field | Where to find it |
|---|---|
| **Library ID** | [zotero.org](https://www.zotero.org/settings/security) → Account → Settings → Security → *"Your userID for API"* |
| **API Key** | Same page → **Create new private key** (read-only access is sufficient) |

Click **Test** to verify your credentials, then **Save Settings**.

### 2. Semantic Scholar login

ZotScholar uses your existing S2 browser session — no separate API key needed for basic use.
Make sure you are **logged in to [semanticscholar.org](https://www.semanticscholar.org)** in the same Chrome profile. The Settings page shows a green indicator when your session is detected.

### 3. S2 API key *(optional)*

An S2 API key increases the paper-search rate limit, which speeds up large imports.
Get a free key at the [S2 API portal](https://www.semanticscholar.org/product/api) and paste it into the **API Key** field.

---

## Features

### One-click collection import
Select one or more collections from your Zotero library tree in the popup, then click **Start Import**.
ZotScholar resolves each paper to a Semantic Scholar ID (via DOI, OpenAlex, or title search) and bulk-imports them into a matching S2 Library folder.

The results card shows three counts at the end of each import:
- **Found on S2** — papers successfully added
- **Already synced** — papers that were already in the folder (skipped)
- **Not found** — papers ZotScholar could not match on S2

### Incremental sync
Re-importing a collection you have already imported only processes **new papers** — ones added to Zotero since the last sync. Previously imported papers are skipped instantly, so re-syncing is fast regardless of collection size.

### Auto-sync
Set a sync interval (1 h / 6 h / 24 h) in Settings → Auto-sync.
ZotScholar silently checks all watched collections in the background and adds any new papers without any user interaction. Use **Sync Now** to trigger an immediate run.

### Research Feed
After a successful import, choose **Enable Research Feed & Done** to activate S2's daily recommendation feed for the imported folder. You can also toggle the feed for any watched collection from the Settings page.

### Watched Collections panel
Settings shows every collection that has been imported at least once. For each collection you can:
- See the paper count and last sync time
- Toggle the **Research Feed** on or off with an animated switch
- Click **Remove** to stop watching it (the S2 folder and its papers are not deleted)
- Use **Detect existing folders** to automatically register any S2 folders whose names match your Zotero collections — useful if you had S2 folders before installing ZotScholar

---

## How it works

1. Reads collections and papers from the **Zotero Web API** (full sub-folder expansion included)
2. Resolves each paper to an S2 ID via DOI → OpenAlex → S2 title-search fallback chain
3. Creates one S2 Library folder per Zotero collection and bulk-adds papers via S2's internal API
4. Stores synced Zotero item keys per collection so future imports are incremental
5. Uses `chrome.alarms` for scheduled background sync without a persistent service worker

---

## Contributors

<a href="https://github.com/qishenzhou/zotscholar/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=qishenzhou/zotscholar" />
</a>

---

## Version history

| Version | Highlights |
|---|---|
| **2.0.0** | Incremental auto-sync, watched collections panel, Research Feed toggle, Detect existing folders, redesigned settings UI |
| 1.5.1 | ZotScholar rename, new icon, options page |
| 1.0.0 | Initial release — manual one-shot import |
