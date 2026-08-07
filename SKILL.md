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
3. How to build Galya `url` — prefer **Storage HTTPS download URL** on the doc for media
4. Galya **domain** + **type** (`text` / `image` / `video` / `audio`)
5. Include/exclude rules

### Content sync (Storage URL on Firestore → Galya media)

```json
{
  "version": 1,
  "defaults": { "domain": "shopping", "idField": "galyaEntityId", "writeBack": true },
  "collections": [
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
  ]
}
```

- `imageUrl` = public/tokenized Firebase Storage download URL (or CDN URL Galya can GET)
- For media types, keep `skipUrlFetch` false so Galya can fetch bytes
- For text catalogs: `type: "text"`, stable page URL, `skipUrlFetch: true` + `content` template

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

**Do:** sync content collections; put Storage URLs on those docs for media; link users via callables after write-back.

**Don’t:** use Storage object triggers as the default content path; expect profile `users` to become Galya users automatically; duplicate assets via both `collections[]` and `storage[]`.

## Repo

https://github.com/cybertheory/galya-firebase
