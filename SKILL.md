---
name: galya-firebase
description: >-
  Sync Firestore collections into Galya taste catalogs (content). Prefer
  Firestore docs that hold Firebase Storage download URLs as Galya media url.
  Use when the user mentions Firebase, Firestore, Storage URLs, Galya content
  domains, clone galya-firebase, Firebase Functions sync, or indexing
  Firebase data into Galya. Does not auto-sync Galya user entities — those
  are created/linked via callables after content ingest.
---

# Galya Firebase Sync

Clone-into-project Cloud Functions that map **Firestore documents → Galya content** (`url`, `type`, `domain`, `content`) via the Galya HTTP API (`src/galyaClient.ts`).

**Primary pattern:** sync catalog rows from Firestore. For images/videos/audio, store a **Firebase Storage download URL** (or CDN URL) on the Firestore doc and point `url` / `type` at that field — do **not** treat Storage object triggers as the main content path.

## What is / isn’t covered

| Goal | Covered? | How |
|------|----------|-----|
| Sync **content** (products, listings, posts, media) | **Yes** | `collections[]` in `galya.sync.json` → `createEntity` content upsert |
| Media via **Storage URLs on Firestore docs** | **Yes (preferred)** | Doc field like `imageUrl` / `coverUrl` → template `url: "{{imageUrl}}"`, `type: "image"` |
| Sync **Galya user** entities from a `users` collection | **No (automatic)** | Create users with `galyaCreateEntity` (`type: "user"`, `name`) then `galyaLinkEntity` after content has `galyaEntityId` |
| Raw Storage bucket watch (`storage[]` pathPrefix) | Optional / advanced | Only for objects with **no** Firestore row; prefer Firestore + URL instead |

## When to use

- User wants Firestore → Galya **content** sync from Cloud Functions
- User names collections/fields (and Storage URL fields) to index into a domain
- User asks how to sync images — answer: put download URLs on the Firestore doc and sync that collection
- User asks to wire `galya.sync.json`, backfill, or Firebase Functions for Galya
- User asks about **users** — explain create/link via callables; sync does not mean-pool parents

## Install into a Firebase project

```bash
git clone https://github.com/cybertheory/galya-firebase.git functions
cd functions && npm install
cp galya.sync.example.json galya.sync.json
```

If `functions/` already exists: copy `src/`, merge `package.json` dependencies (`firebase-admin`, `firebase-functions`), and add `galya.sync.json`.

## Secrets — set Galya API key in Firebase

Code binds `GALYA_API_KEY` with `defineSecret("GALYA_API_KEY")` (`src/params.ts`). Sync triggers + callables declare `secrets: [galyaApiKey]`.

### Production (agent must do this for the user)

```bash
firebase login
firebase use <project-id>
firebase functions:secrets:set GALYA_API_KEY
cd functions && npm install && npm run build
cd .. && firebase deploy --only functions
```

Verify: `firebase functions:secrets:access GALYA_API_KEY`

### Local emulator

```bash
cd functions
cp .env.example .env
export $(grep -v '^#' .env | xargs)
npm run build
firebase emulators:start --only functions
```

Prefer **`galya_wsk_…`**. Account secrets (`galya_sk_…`) need `GALYA_WORKSPACE_ID`. Never commit keys.

## Write `galya.sync.json`

Ask the user for:

1. Collection paths for **content** (e.g. `products`, `listings`)
2. Which fields to sync (include the Storage download URL field if media)
3. How to build Galya `url`:
   - **Media:** publicly downloadable HTTPS URL (Firebase Storage download URL with token, or public CDN)
   - **Text:** stable HTTPS URI used as **dedup key only** (product page, or synthetic `https://app.example.com/items/{{id}}`) — Galya need not fetch it if `skipUrlFetch` is true
4. **Required: Galya `domain`** — must match the catalog taste space (wrong domain = wrong embeddings / landscapes). Confirm with the user; do not guess silently.
5. Galya **type** (`text` / `image` / `video` / `audio`)
6. Include/exclude rules

### Domain is required

Every synced content object needs a correct **`domain`** (collection-level or `defaults.domain`). Galya uses it for indexing, embedding/routing, and dashboard taste landscapes.

Allowed values:

`uiux` · `professional` · `shopping` · `fashion` · `restaurants` · `travel` · `hospitality` · `conversation`

Aliases: `ecommerce` → shopping, `linkedin` → professional, `ux` → uiux.

**Agent rules:**

- Always set `domain` (or `defaults.domain`) before deploy — validation fails if missing
- Ask which domain fits the collection; if unclear, ask rather than defaulting blindly
- Use one domain per collection when catalogs differ (e.g. products → `shopping`, stays → `travel`)
- Do not invent domain strings outside the list above

### Media content (image / video / audio)

Galya **downloads bytes from `url`**. That URL must be **publicly reachable by Galya’s servers** (HTTPS GET).

Use Firestore fields that already store a downloadable URL:

- Firebase Storage **token download URL**  
  `https://firebasestorage.googleapis.com/v0/b/<bucket>/o/<path>?alt=media&token=<token>`
- Or a public CDN / signed URL that remains valid long enough for indexing

```json
{
  "path": "products",
  "domain": "shopping",
  "type": "image",
  "fields": ["title", "description", "imageUrl", "status"],
  "url": "{{imageUrl}}",
  "content": "{{title}}\n{{description}}",
  "skipUrlFetch": false,
  "rules": { "includeWhen": { "status": "published" } }
}
```

**Checklist for agents / developers:**

- Confirm Storage rules or tokens allow unauthenticated GET (or a durable signed URL)
- Do **not** use `gs://` paths, private bucket paths without tokens, or app-only auth URLs
- Keep `skipUrlFetch: false` (default for media) so Galya can fetch
- Optional `content` = caption / notes for the model, not a substitute for the media URL

### Text content (no media file to download)

Galya still requires a `url` field as the **stable dedup key**, but you can skip fetching the page and embed **inline text** from Firestore fields.

Procedure:

1. Set `type: "text"`
2. Set `url` to a **stable unique HTTPS URI** per doc (canonical page, or synthetic e.g. `https://yourapp.com/items/{{id}}`)
3. Set `skipUrlFetch: true`
4. Set `content` to a mustache template over the text fields Galya should embed

```json
{
  "path": "posts",
  "domain": "conversation",
  "type": "text",
  "fields": ["title", "body", "status"],
  "url": "https://app.example.com/posts/{{id}}",
  "content": "{{title}}\n\n{{body}}",
  "skipUrlFetch": true,
  "rules": { "includeWhen": { "status": "published" } }
}
```

Notes:

- Inline `content` is what gets embedded when `skipUrlFetch` is true — make it rich enough
- The synthetic/page `url` should stay stable across updates so reindex dedups correctly
- If you also want Galya to scrape a real public webpage, set `url` to that page and `skipUrlFetch: false` (no need for a large `content` body)

### Users (not collection sync)

Do **not** map Firestore profile `users` into content unless those docs are catalog items.

Attach content to a Galya user:

1. `galyaCreateEntity` → `{ type: "user", name: "…" }`
2. After sync write-back → `galyaLinkEntity` `{ parent_id: userId, entity_id: doc.galyaEntityId }`

### Domains

`uiux` · `professional` · `shopping` · `fashion` · `restaurants` · `travel` · `hospitality` · `conversation`

### Optional: raw Storage object watch

Only if uploads have **no** Firestore document. Prefer Firestore + URL. Avoid enabling `storage[]` and `collections[]` for the same assets (duplicate content).

## Deploy / backfill

```bash
npm run build && firebase deploy --only functions
# Callable (Auth required):
# galyaBackfill { "paths": ["products"], "batchSize": 50 }
```

## Callables (Auth required)

| Callable | Use |
|----------|-----|
| `galyaCreateEntity` | Content upsert **or** `{ type: "user", name }` |
| `galyaLinkEntity` | Link content → user after sync |
| `galyaCreateEntityBatch` / `galyaGetEntity` / `galyaDeleteEntity` | Batch / CRUD |
| `galyaSearch` / `galyaRerank` / `galyaRecommend` / `galyaAsk` / `galyaExplain` / `galyaGauge` | Taste / language ops |

## Do / Don’t

**Do:** sync content collections; set the correct **`domain`**; for media use **publicly downloadable** HTTPS URLs; for text use `skipUrlFetch: true` + rich `content`; link users via callables after write-back.

**Don’t:** point media `url` at private/`gs://` paths; omit `domain`; use Storage object triggers as the default content path; expect profile `users` to become Galya users automatically.

## Repo

https://github.com/cybertheory/galya-firebase
