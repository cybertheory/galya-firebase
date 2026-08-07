# Galya Firebase Sync

**Sync Firestore + Storage into Galya taste catalogs.**

The Algolia Firebase pattern — built on [Galya](https://galya.io) content domains. Clone this repo into your Firebase Functions project, name the collections and fields you care about, and every write becomes taste-ready content.

```
Firestore write  ──►  Cloud Function  ──►  Galya POST /v1/entity
Storage upload ──►  Cloud Function  ──►  Galya content (image/video/…)
```

One clone. **As many collections as you need.** Declarative rules. Optional Storage prefixes. Full backfill when you’re ready.

---

## Why Galya (not another search index)

| | Typical search sync | **Galya Firebase Sync** |
|---|---|---|
| Destination | Keyword / vector index | **Taste catalog** (`domain` + embeddings) |
| Collections | Often one install per collection | **Many collections in one `galya.sync.json`** |
| Media | URLs as strings | **Storage → image / video / audio content** |
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

### 3. Set your Galya secret

```bash
firebase functions:secrets:set GALYA_API_KEY
# paste galya_wsk_… from Dashboard → workspace → API keys
```

Or for local / `.env` (never commit):

```bash
cp .env.example .env
# GALYA_API_KEY=galya_wsk_…
```

Wire the secret into your deploy (params / `defineSecret`) or export it in the Functions runtime environment. Account keys (`galya_sk_…`) also need `GALYA_WORKSPACE_ID`.

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

## Config reference (`galya.sync.json`)

```json
{
  "version": 1,
  "defaults": {
    "domain": "shopping",
    "type": "text",
    "batchSize": 50,
    "skipUrlFetch": true
  },
  "collections": [
    {
      "path": "products",
      "domain": "shopping",
      "type": "text",
      "fields": ["title", "description", "imageUrl", "status"],
      "url": "{{imageUrl}}",
      "content": "{{title}}\n{{description}}",
      "ref": "{{id}}",
      "rules": {
        "includeWhen": { "status": "published" },
        "excludeWhen": { "draft": true }
      }
    }
  ],
  "storage": [
    {
      "pathPrefix": "catalog/images/",
      "domain": "fashion",
      "type": "image",
      "url": "downloadUrl",
      "contentFromMetadata": ["customMetadata.caption"],
      "rules": {
        "contentTypes": ["image/jpeg", "image/png", "image/webp"],
        "minSizeBytes": 1024
      }
    }
  ]
}
```

### Collections

| Field | Description |
|-------|-------------|
| `path` | Firestore collection or `users/{uid}/listings`-style path |
| `fields` | Allowlist (omit = all top-level fields). Unrelated field updates are skipped |
| `url` | Mustache template → Galya **dedup key** (required, must be a stable HTTPS URL) |
| `content` | Mustache template → inline text for embeddings |
| `domain` | Taste domain (see below) |
| `type` | `text` \| `image` \| `video` \| `audio` |
| `ref` | Optional correlation token echoed on search/rerank |
| `idField` | Optional document field holding an existing Galya content entity id |
| `skipUrlFetch` | Default: true when `type` is `text` and `content` is set |
| `rules.includeWhen` | Shallow equality — all keys must match |
| `rules.excludeWhen` | Shallow equality — match → do not sync (deletes prior Galya entity if mapped) |

Templates always have `{{id}}` (doc id) and `{{path}}` (full document path).

### Storage

| Field | Description |
|-------|-------------|
| `pathPrefix` | Object name prefix to watch |
| `domain` / `type` | Galya content domain and media type |
| `url` | `downloadUrl` (default) or a template (`{{name}}`, `{{bucket}}`, …) |
| `contentFromMetadata` | Dot-paths under object metadata for captions |
| `rules.contentTypes` | MIME allowlist |
| `rules.minSizeBytes` / `maxSizeBytes` | Size gates |

### Domains

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

1. **Write** — `onDocumentWritten` maps the doc → Galya `ContentObject`, calls `createEntity`, waits for the async index job.
2. **Delete / rule exclude** — looks up `_galya_sync/{hash}` and calls `deleteEntity` when an `entityId` is known.
3. **Storage** — finalize builds a download/signed URL and upserts media content; delete cleans the mapping.
4. **Mapping store** — `_galya_sync` in your Firestore project tracks `sourceKey → entityId` so deletes stay consistent.

Prefer **stable public HTTPS URLs** for `url` (product pages, CDN images). Align them with `data-galya-id` / signal capture in your app when you personalize later.

---

## Security & billing

- **Never commit** `GALYA_API_KEY` or publishable keys to git.
- Use a **workspace secret** (`galya_wsk_…`) scoped to the target workspace.
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
| Deletes don’t remove Galya content | Ensure mapping exists (doc was synced at least once); check Functions logs for `deleteEntity` |
| Auth error on backfill | Call while signed in; grant `cloudfunctions.functions.invoke` to admins |
| Path change not triggering | Redeploy after editing `collections[].path` |

---

## License

MIT © Galya

Built for the [Galya content API](https://docs.galya.io). Not an official Firebase Extension — clone and own your Functions code.
