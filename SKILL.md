---
name: galya-firebase
description: >-
  Sync Firestore collections and Firebase Storage into Galya taste catalogs.
  Use when the user mentions Firebase, Firestore, Storage sync, Galya content
  domains, clone galya-firebase, Algolia-style Firebase sync, or indexing
  Firebase data into Galya.
---

# Galya Firebase Sync

Clone-into-project Cloud Functions that map Firestore documents and Storage objects to Galya **content** (`url`, `type`, `domain`, `content`) via the Galya HTTP API (`src/galyaClient.ts`).

## When to use

- User wants Firestore → Galya sync (like Algolia’s Firebase extension)
- User names collections/fields to index into a Galya domain
- User wants Storage images/videos as Galya media content
- User asks to wire `galya.sync.json`, backfill, or Firebase Functions for Galya

## Install into a Firebase project

```bash
# Prefer clone as the functions package
git clone https://github.com/cybertheory/galya-firebase.git functions
cd functions && npm install
cp galya.sync.example.json galya.sync.json
```

If `functions/` already exists: copy `src/`, merge `package.json` dependencies (`firebase-admin`, `firebase-functions`), and add `galya.sync.json`.

## Secrets — set Galya API key in Firebase

Code binds `GALYA_API_KEY` with `defineSecret("GALYA_API_KEY")` (`src/params.ts`). Sync triggers + callables declare `secrets: [galyaApiKey]`.

### Production (agent must do this for the user)

```bash
# From Firebase project root (parent of functions/)
firebase login
firebase use <project-id>

# Paste galya_wsk_… from Galya Dashboard → workspace → API keys → Secret keys
firebase functions:secrets:set GALYA_API_KEY

# Optional string params via functions/.env.<PROJECT_ID> (do not put API key here):
#   GALYA_WORKSPACE_ID=ws_…     # only for galya_sk_ account secrets
#   GALYA_BASE_URL=https://api.galya.io/v1

cd functions && npm install && npm run build
cd .. && firebase deploy --only functions
# Grant access to secret GALYA_API_KEY when the CLI asks
```

Verify:

```bash
firebase functions:secrets:access GALYA_API_KEY
```

Rotate: `firebase functions:secrets:set GALYA_API_KEY` then redeploy.

### Local emulator

```bash
cd functions
cp .env.example .env   # set GALYA_API_KEY=galya_wsk_…
export $(grep -v '^#' .env | xargs)
npm run build
firebase emulators:start --only functions
```

### Key rules

- Prefer **`galya_wsk_…`** (workspace secret). Never publishable keys.
- **`galya_sk_…`** requires `GALYA_WORKSPACE_ID`.
- Never commit secrets; keep `GALYA_API_KEY` in Secret Manager for prod.

Never invent API shapes — use the in-repo `GalyaClient` (`src/galyaClient.ts`) which matches Galya’s content API (`createEntity`, `createEntityBatch`, `waitForEntityJob`, `deleteEntity`). Optionally swap to `@galya/agents` when you already depend on it.

## Write `galya.sync.json`

Ask the user for:

1. Collection paths (e.g. `products`, `users/{uid}/listings`)
2. Which fields to sync
3. How to build a **stable HTTPS `url`** (dedup key) — product page or image CDN
4. Galya **domain** per collection
5. Include/exclude rules (e.g. only `status: published`)

Minimal example:

```json
{
  "version": 1,
  "defaults": { "domain": "shopping", "type": "text", "skipUrlFetch": true },
  "collections": [
    {
      "path": "products",
      "fields": ["title", "description", "imageUrl", "status"],
      "url": "https://shop.example.com/p/{{id}}",
      "content": "{{title}}\n{{description}}",
      "rules": { "includeWhen": { "status": "published" } }
    }
  ]
}
```

### Domains

`uiux` · `professional` · `shopping` · `fashion` · `restaurants` · `travel` · `hospitality` · `conversation`  
Aliases: `ecommerce`→shopping, `linkedin`→professional.

### Content types

`text` | `image` | `video` | `audio`

### Rules (v1)

- `includeWhen`: shallow equality, all keys must match
- `excludeWhen`: shallow equality → skip sync; if previously synced, `deleteEntity` + clear write-back fields
- Templates: `{{field}}`, `{{a.b}}`, plus `{{id}}`, `{{path}}`
- **`idField`** (default `galyaEntityId`): read for in-place reindex; **written back** after upsert with `galyaSyncedAt`. Set `idField: null` or `writeBack: false` to disable.

### Storage block

```json
"storage": [{
  "pathPrefix": "catalog/images/",
  "domain": "fashion",
  "type": "image",
  "url": "downloadUrl",
  "rules": { "contentTypes": ["image/jpeg", "image/png", "image/webp"] }
}]
```

## Deploy

```bash
npm run build
firebase deploy --only functions
```

**Redeploy after changing `path` or `pathPrefix`** — triggers are bound at deploy time from config.

## Backfill

Callable `galyaBackfill` (Firebase Auth required):

```json
{ "paths": ["products"], "batchSize": 50 }
```

## Galya ops callables

All require Firebase Auth. Use these so clients never hold the workspace secret:

| Callable | Data |
|----------|------|
| `galyaGauge` | `{ response, followup, prompt? }` |
| `galyaSearch` | `{ relativeToEntityId, inTermsOfEntityType, query }` |
| `galyaRerank` | `{ relativeToEntityId, inTermsOfEntityType, candidates, history?, domain? }` |
| `galyaRecommend` | `{ relativeToEntityId, inTermsOfEntityType, candidates, history, domain? }` |
| `galyaAsk` / `galyaExplain` | `{ relativeToEntityId, inTermsOfEntityType, query, … }` |
| `galyaCreateEntity` | content upsert or parent + `linked_content` |
| `galyaCreateEntityBatch` | `{ content[], ids? }` |
| `galyaGetEntity` / `galyaDeleteEntity` | `{ entity_id }` |
| `galyaLinkEntity` | `{ parent_id, entity_id, rel?, weight? }` |
| `galyaGetEntityJob` | `{ job_id }` |

## Mapping store

Synced sources are tracked in Firestore `_galya_sync/{hash}` (`sourceKey` → `entityId`). Do not treat this as app data; it enables deletes.

## Do / Don’t

**Do**

- Prefer stable public HTTPS URLs for Galya `url`
- Rely on write-back: after sync, docs get `galyaEntityId` (and `galyaSyncedAt`) for stable in-place reindex
- Use workspace secrets (`galya_wsk_`)
- Set `skipUrlFetch: true` when providing enough inline `content` for text
- Align catalog URLs with client signal capture (`data-galya-id`) when personalizing

**Don’t**

- Invent Galya REST payloads — use `src/galyaClient.ts` (or `@galya/agents`)
- Commit API keys
- Put `galyaEntityId` in your `fields` allowlist unless you intentionally want edits to that field to re-trigger sync (write-back-only updates are ignored either way)
- Expect parent `linked_content` / user mean-pool from this sync (do that separately after ingest)
- Use deep query DSLs — only shallow `includeWhen` / `excludeWhen` in v1

## Repo

https://github.com/cybertheory/galya-firebase
