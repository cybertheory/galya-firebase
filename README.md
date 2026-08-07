# Galya Firebase Sync

**Sync Firestore into Galya taste catalogs.**

> **API key (required):** use a Galya **secret** key only — `galya_wsk_…` (preferred) or `galya_sk_…` (+ `GALYA_WORKSPACE_ID`).  
> **Do not** use publishable keys (`galya_wpub_…` / `galya_pub_…`). Those are for browser/iOS SDKs and are rejected by this package and by `api.galya.io` content routes.

Clone this repo into your Firebase Functions project, name the collections and fields you care about, and every write becomes taste-ready **content** — built on [Galya](https://galya.io) content domains.

For images and other media, put a **publicly downloadable** Firebase Storage (or CDN) HTTPS URL on the Firestore document and sync that field as Galya `url`. Galya’s indexer must be able to GET it.

For **text-only** rows (no file to download): still provide a stable `url` as the dedup key, set `type: "text"`, `skipUrlFetch: true`, and put the embeddable body in the `content` template from Firestore fields.

```
Firestore doc (incl. Storage URL fields)  ──►  Cloud Function  ──►  Galya content
```

One clone. **As many collections as you need.** Declarative rules. Media via Storage URLs on Firestore docs. Full backfill when you’re ready.

---

## Why Galya (not another search index)

| | Typical search sync | **Galya Firebase Sync** |
|---|---|---|
| Destination | Keyword / vector index | **Taste catalog** (`domain` + embeddings) |
| Collections | Often one install per collection | **Many collections in one `galya.sync.json`** |
| Media | Separate pipelines | **Firestore fields holding Storage/CDN URLs** → `type: image\|video\|audio` |
| API | Proprietary index objects | Galya primitives: `url`, `type`, `domain`, `content` |

Under the hood we call the same Galya content API as [`@galya/agents`](https://www.npmjs.com/package/@galya/agents) (`POST /v1/entity`, batch, delete) via a small in-repo HTTP client so this clone template stays deployable without extra packages.

---

## Quick start

### 1. Clone into your Functions folder

```bash
# New project: use this repo as functions/
git clone https://github.com/cybertheory/galya-firebase.git functions
cd functions
npm install

# Or merge into an existing functions/ package — copy src/, package deps, and galya.sync.json
```

### 2. Configure sync

```bash
cp galya.sync.example.json galya.sync.json
# Edit collections, fields, domains, and rules
```

### 3. Set your Galya API key in Firebase

This repo binds `GALYA_API_KEY` via Firebase **Secret Manager** (`defineSecret` in `src/params.ts`). Every sync trigger and Galya callable lists that secret, so Cloud Functions receive it at runtime without putting the key in source.

#### Production (recommended)

1. Create a **workspace secret** in Galya: Dashboard → your workspace → **API keys** → **Secret keys** → copy a `galya_wsk_…` value.  
   **Required key type:** secret (`galya_wsk_…` or `galya_sk_…`).  
   **Forbidden:** publishable (`galya_wpub_` / `galya_pub_`) — rejected at runtime by this package and on API routes.

2. From your **Firebase project root** (the directory with `.firebaserc` / `firebase.json`, usually the parent of `functions/`):

```bash
firebase login
firebase use <your-firebase-project-id>

# Interactive prompt — paste the galya_wsk_… value (not echoed)
firebase functions:secrets:set GALYA_API_KEY
```

3. Optional non-secret params — create `functions/.env.<PROJECT_ID>` (never commit):

```bash
# functions/.env.my-prod-project
GALYA_WORKSPACE_ID=   # leave empty when using galya_wsk_
GALYA_BASE_URL=https://api.galya.io/v1
```

`GALYA_API_KEY` itself must stay in **Secret Manager** (`functions:secrets:set`), not in `.env` files that might be checked in.

4. Deploy (first deploy after creating the secret will grant the Functions runtime access):

```bash
cd functions && npm install && npm run build
cd .. && firebase deploy --only functions
```

When the CLI asks to grant access to secret `GALYA_API_KEY`, accept.

5. Verify the secret exists:

```bash
firebase functions:secrets:access GALYA_API_KEY
# or list:
firebase functions:secrets:get GALYA_API_KEY
```

6. Rotate later:

```bash
firebase functions:secrets:set GALYA_API_KEY   # paste new value
firebase deploy --only functions               # pick up new version
```

#### Local emulator

```bash
cd functions
cp .env.example .env
# Edit .env:
#   GALYA_API_KEY=galya_wsk_…
#   GALYA_WORKSPACE_ID=          # if using galya_sk_
#   GALYA_BASE_URL=https://api.galya.io/v1

# Secret Manager is not used the same way in emulators — export before serve:
export $(grep -v '^#' .env | xargs)
npm run build
firebase emulators:start --only functions
```

#### Account secret vs workspace secret

| Key | Header | Extra |
|-----|--------|--------|
| `galya_wsk_…` (preferred) | `X-API-Key` | Workspace is implied by the key |
| `galya_sk_…` | `X-API-Key` | Also set `GALYA_WORKSPACE_ID` (workspace `publicId`) |

#### Troubleshooting

| Symptom | Fix |
|---------|-----|
| `GALYA_API_KEY is required` | Secret not set or function not redeployed after `secrets:set` |
| `permission-denied` / 401 from Galya | Wrong key type (publishable) or revoked key |
| Deploy asks about secrets | Choose to grant `GALYA_API_KEY` to the new/updated functions |
| Emulator works, prod fails | Prod uses Secret Manager only — confirm `firebase functions:secrets:access GALYA_API_KEY` |

### 4. Deploy

```bash
# From your Firebase project root (parent of functions/)
firebase deploy --only functions
```

**Changing collection paths or Storage prefixes requires a redeploy** — triggers are registered from `galya.sync.json` at deploy time.

### 5. Backfill existing docs

```bash
firebase functions:call galyaBackfill --data '{}'
# Optional: { "paths": ["products"], "limitPerCollection": 100, "batchSize": 50 }
```

Requires a signed-in caller (Firebase Auth). Restrict invoke IAM to admins in production.

---

## Callable Galya ops

All require **Firebase Auth**. They proxy your workspace secret to the Galya API so clients never hold `galya_wsk_…`.

| Callable | Purpose | Payload (high level) |
|----------|---------|----------------------|
| `galyaGauge` | Reply resonance `[0,1]` | `{ response, followup, prompt? }` |
| `galyaSearch` | Taste search | `{ relativeToEntityId, inTermsOfEntityType, query, additional_candidates? }` |
| `galyaRerank` | Rank candidates | `{ relativeToEntityId, inTermsOfEntityType, candidates, history?, domain?, … }` |
| `galyaRecommend` | Recommend from history | `{ relativeToEntityId, inTermsOfEntityType, candidates, history, domain?, … }` |
| `galyaAsk` | Ask relative to an entity | `{ relativeToEntityId, inTermsOfEntityType, query }` |
| `galyaExplain` | Explain a query | `{ relativeToEntityId, inTermsOfEntityType, query, domain?, task? }` |
| `galyaCreateEntity` | Create / upsert entity or content | `{ content }` or `{ type, name, linked_content? }` — `wait` defaults true |
| `galyaCreateEntityBatch` | Batch content upsert | `{ content: ContentObject[], ids?, wait? }` |
| `galyaGetEntityJob` | Poll async job | `{ job_id }` |
| `galyaGetEntity` | Fetch entity | `{ entity_id }` |
| `galyaDeleteEntity` | Delete entity | `{ entity_id }` |
| `galyaLinkEntity` | Link child → parent (mean-pool) | `{ parent_id, entity_id, rel?, weight? }` |
| `galyaBackfill` | Reindex configured collections | `{ paths?, batchSize?, limitPerCollection? }` |

Client example (Web):

```ts
import { getFunctions, httpsCallable } from "firebase/functions";

const functions = getFunctions();
const gauge = httpsCallable(functions, "galyaGauge");
const { data } = await gauge({
  response: "Here are three linen shirts…",
  followup: "Show me something darker",
  prompt: "Find summer shirts",
});
// data.resonance ∈ [0, 1]
```

Snake_case aliases (`relative_to_entity_id`, `entity_id`, …) are accepted where noted.

---

## Config reference (`galya.sync.json`)

```json
{
  "version": 1,
  "defaults": {
    "domain": "shopping",
    "batchSize": 50,
    "idField": "galyaEntityId",
    "writeBack": true
  },
  "collections": [
    {
      "path": "products",
      "domain": "shopping",
      "type": "image",
      "fields": ["title", "description", "imageUrl", "status"],
      "url": "{{imageUrl}}",
      "content": "{{title}}\n{{description}}",
      "ref": "{{id}}",
      "skipUrlFetch": false,
      "rules": {
        "includeWhen": { "status": "published" },
        "excludeWhen": { "draft": true }
      }
    }
  ]
}
```

Here `imageUrl` must be a **publicly downloadable** HTTPS URL (Firebase Storage download URL with token, or public CDN). Galya GETs that URL to enrich media — private/`gs://` paths will fail.

### Text-only content (no file download)

`url` is still required as the **dedup key**, but Galya does not need to fetch a page:

1. `type: "text"`
2. Stable unique HTTPS `url` (canonical page or synthetic `https://yourapp.com/items/{{id}}`)
3. `skipUrlFetch: true`
4. `content` template from Firestore text fields (this is what gets embedded)

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

### Collections

| Field | Description |
|-------|-------------|
| `path` | Firestore collection or `users/{uid}/listings`-style path |
| `fields` | Allowlist (omit = all top-level fields). Unrelated field updates are skipped |
| `url` | Mustache → Galya **dedup key** (required HTTPS URI). Media: publicly downloadable Storage/CDN URL. Text: stable page or synthetic URI |
| `content` | Mustache → inline text / captions. **Required in practice for text + `skipUrlFetch`** |
| `domain` | **Required** taste domain (or set `defaults.domain`). Wrong domain misroutes embeddings — see Domains below |
| `type` | `text` \| `image` \| `video` \| `audio` |
| `ref` | Optional correlation token echoed on search/rerank |
| `idField` | Firestore field for Galya entity id (**default `galyaEntityId`**). Read on sync + **written back** after upsert. Set `null` to disable |
| `writeBack` | Write `idField` + `galyaSyncedAt` onto the source doc (default `true` when `idField` enabled) |
| `skipUrlFetch` | **`true` for text** (embed `content` only). **`false` for media** so Galya can GET `url` |
| `rules.includeWhen` | Shallow equality — all keys must match |
| `rules.excludeWhen` | Shallow equality — match → do not sync (deletes prior Galya entity if mapped) |

Templates always have `{{id}}` (doc id) and `{{path}}` (full document path).

### Users

Sync does **not** turn Firestore profile `users` into Galya `user` entities. Create users with `galyaCreateEntity` (`type: "user"`) and attach synced content with `galyaLinkEntity` using the write-back `galyaEntityId`.

### Optional: raw Storage object watch

`storage[]` watches a bucket path prefix for orphan uploads (no Firestore row). Prefer Firestore + Storage URL above. Do not enable both for the same assets.

| Field | Description |
|-------|-------------|
| `pathPrefix` | Object name prefix to watch |
| `domain` / `type` | Galya content domain and media type |
| `url` | `downloadUrl` (default) or a template (`{{name}}`, `{{bucket}}`, …) |
| `contentFromMetadata` | Dot-paths under object metadata for captions |
| `writeBack` | Write `galyaEntityId` into custom metadata after upsert (default `true`) |
| `rules.contentTypes` | MIME allowlist |
| `rules.minSizeBytes` / `maxSizeBytes` | Size gates |

### Domains

**Required on every collection** (or via `defaults.domain`). Domain selects embedding/routing and taste landscapes — set it deliberately.

| Domain | Use for |
|--------|---------|
| `shopping` | Products, catalogs (`ecommerce` alias accepted) |
| `fashion` | Apparel, lookbooks |
| `travel` | Stays, destinations |
| `restaurants` | Dining |
| `hospitality` | Hotels / hospitality (distinct from restaurants) |
| `uiux` | Interfaces, design surfaces |
| `professional` | Careers / LinkedIn-style (`linkedin` alias) |
| `conversation` | Dialogue / chat-oriented content |

See [Content domains](https://docs.galya.io) in Galya docs for the latest vocabulary.

---

## How sync works

1. **Firestore write** — maps the doc → Galya `ContentObject` (including Storage/CDN URL fields), upserts content, waits for the index job, then **writes `galyaEntityId`** back onto the doc.
2. **Delete / rule exclude** — deletes the Galya entity when mapped; clears write-back fields.
3. **Users** — not auto-synced; create/link via callables using write-back ids.
4. **Optional Storage watch** — only for orphan objects without a Firestore row.

Write-back-only updates are ignored so the sync does not loop. Align catalog URLs with client signal capture (`data-galya-id`) when you personalize later.

---

## Security & billing

- **Never commit** `GALYA_API_KEY` to git.
- Store production keys with **`firebase functions:secrets:set GALYA_API_KEY`** (Secret Manager), not in `galya.sync.json` or committed `.env`.
- **Secret keys only:** `galya_wsk_…` (preferred) or `galya_sk_…` + workspace id. Publishable keys belong in the browser/iOS SDKs, not here.
- Firebase requires the **Blaze** plan for outbound Galya API calls from Cloud Functions.
- Galya usage follows your workspace plan (indexing + embeddings).

---

## Agent skill

For Cursor / Claude / OpenClaw agents wiring this up for you:

```bash
# Install the skill
mkdir -p .cursor/skills/galya-firebase
curl -o .cursor/skills/galya-firebase/SKILL.md \
  https://raw.githubusercontent.com/cybertheory/galya-firebase/main/SKILL.md
```

Or open [`SKILL.md`](./SKILL.md) in this repo.

---

## Project layout

```
galya-firebase/
├── galya.sync.example.json   # Copy → galya.sync.json
├── src/                      # Cloud Functions (TypeScript)
├── examples/ecommerce-products/
├── README.md
└── SKILL.md
```

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `missing galya.sync.json` | Copy the example and redeploy |
| Empty `url` errors | Fix the `url` template — Galya requires a non-empty URI |
| Media index fails / empty enrich | Ensure `url` is **publicly downloadable** HTTPS (Storage token URL or CDN), not `gs://` / private |
| Text embeds look empty | Set `skipUrlFetch: true` and a rich `content` template from Firestore fields |
| Deletes don’t remove Galya content | Ensure mapping exists (doc was synced at least once); check Functions logs for `deleteEntity` |
| Auth error on backfill | Call while signed in; grant `cloudfunctions.functions.invoke` to admins |
| Path change not triggering | Redeploy after editing `collections[].path` |

---

## License

MIT © Galya

Built for the [Galya content API](https://docs.galya.io). Not an official Firebase Extension — clone and own your Functions code.
