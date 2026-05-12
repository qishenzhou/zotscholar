# ZotScholar  (Chrome Extension)

Import Zotero collections into your Semantic Scholar Library with one click,
preserving folder structure so S2 can generate **daily paper recommendations** for each topic.

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

1. Click the ZotScholar toolbar icon
2. Click **⚙ Settings** and enter your credentials (one-time setup)
3. Back in the popup, pick one or more Zotero collections from the tree
4. Click **Start Import →** — ZotScholar finds each paper on S2 and imports it into a matching folder
5. The popup can be closed while the job runs; reopening it resumes the progress view
6. Click **Done** when finished to return to the collection picker

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
