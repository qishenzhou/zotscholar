# ZotScholar  (Chrome Extension)

Import Zotero collections into your Semantic Scholar Library with one click,
preserving folder structure so S2 can generate **daily paper recommendations** for each topic.
Supports incremental **auto-sync** — new papers added to Zotero appear in S2 automatically.

---

## Install

1. Download / clone this folder
2. Open Chrome → `chrome://extensions`
3. Toggle **Developer mode** ON (top-right)
4. Click **Load unpacked** → select the `zotero_to_s2_extension` folder
5. The ZotScholar icon appears in your toolbar

> **Share with others**: zip up this folder and send the `.zip`.
> They unzip and follow the same steps above.

---

## Usage

### First-time setup
1. Click the ZotScholar toolbar icon
2. Click **⚙ Settings** → enter your Zotero Library ID and API key, then **Save Settings**
3. Make sure you are **logged in to Semantic Scholar** in the same Chrome profile

### Importing a collection
1. Pick one or more Zotero collections from the tree in the popup
2. Click **Start Import →** — ZotScholar resolves each paper on S2 and imports it into a matching folder
3. When done, optionally click **Enable Research Feed & Done** to turn on daily paper recommendations for that folder
4. The popup can be closed while the job runs; reopening it resumes the progress view

### Re-importing / incremental update
- Selecting a collection you have already imported triggers an **incremental sync** — only papers added since the last import are processed
- The results card shows: **Found on S2** (new) · **Already synced** (skipped) · **Not found**

### Auto-sync
Set a sync interval in Settings (1 h / 6 h / 24 h).  
ZotScholar silently checks all **watched collections** in the background and adds any new papers.

---

## Watched Collections & Research Feed

The **Settings → Watched Collections** panel lists every collection that has been imported at least once.

- **Feed toggle** — green = Research Feed enabled for that S2 folder, grey = off.  Click to toggle.
- **Remove** — stop watching a collection (does not delete the S2 folder or its papers).
- **Detect existing folders** — if you had S2 folders before installing ZotScholar, this button matches them to your Zotero collections by name and registers them as watched.

---

## Where to get credentials

| Credential | Where |
|---|---|
| **Zotero Library ID** | zotero.org → Account → Settings → Security → "Your userID for API" |
| **Zotero API key** | Same page → Create new private key (read-only is enough) |
| **S2 API key** *(optional)* | semanticscholar.org/product/api — free tier, higher rate limit |

You must also be **logged in to Semantic Scholar** in the same Chrome profile.

---

## Why a browser extension?

| | Extension | Python script |
|---|---|---|
| Install | Load 1 folder in Chrome | pip + playwright + chromium |
| S2 auth | Automatic (reads your session) | Manual browser login step |
| Share | Send a zip file | Share repo + setup instructions |
| Runs on | Any OS with Chrome | Needs Python 3.10+ |

---

## How it works

1. Reads collections & papers from the **Zotero Web API** (with full sub-folder expansion)
2. Resolves each paper to a Semantic Scholar ID via DOI lookup, OpenAlex, and S2 title search
3. Uses Chrome's `cookies` permission to authenticate with your S2 session
4. Creates one S2 Library folder per Zotero collection and bulk-adds papers into each
5. Stores a list of synced Zotero item keys per collection so future imports are incremental
6. Uses `chrome.alarms` for background auto-sync without keeping a persistent service worker

---

## Version history

| Version | Highlights |
|---|---|
| **2.0.0** | Incremental auto-sync, watched collections panel, Research Feed toggle, Detect existing folders, redesigned settings UI |
| 1.5.1 | ZotScholar rename, new icon, options page |
| 1.0.0 | Initial release — manual one-shot import |
