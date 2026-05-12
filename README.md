# Zotero → Semantic Scholar  (Chrome Extension)

Import a Zotero collection into your Semantic Scholar Library folder with one click,
so S2 can generate **daily paper recommendations** for that topic.

---

## Install (for you or anyone you share it with)

1. Download / clone this folder
2. Open Chrome → address bar → `chrome://extensions`
3. Toggle **Developer mode** ON (top-right)
4. Click **Load unpacked** → select the `zotero_to_s2_extension` folder
5. The 📚 icon appears in your toolbar

> **Share with others**: zip up this folder and send the `.zip`.
> They unzip and follow the same 4 steps above.

---

## Usage

1. Click the 📚 toolbar icon
2. **Step 1 — Credentials**: enter your Zotero Library ID + API key
   (+ optional S2 API key for faster lookups)
3. **Step 2 — Collection**: pick a Zotero collection, set the S2 folder name
4. **Step 3**: extension searches Semantic Scholar for each paper
5. **Step 4**: papers are added to your S2 Library folder automatically

Credentials are saved locally — no need to re-enter them next time.

---

## Where to get credentials

| Credential | Where |
|---|---|
| **Zotero Library ID** | zotero.org → Settings → Feeds/API → "Your userID" |
| **Zotero API key** | Same page → Create new private key (read-only is enough) |
| **S2 API key** *(optional)* | semanticscholar.org/product/api — free, higher rate limit |

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

1. Reads collections & papers from the **Zotero Web API**
2. Resolves each paper to a Semantic Scholar ID via the **S2 Graph API** (DOI first, then title search)
3. Uses Chrome's `cookies` permission to read your S2 session — no login required
4. Calls S2's internal library API to bulk-add papers to your folder
