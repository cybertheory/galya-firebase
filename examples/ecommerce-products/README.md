# Ecommerce products example

Minimal config that syncs a top-level Firestore `products` collection into Galya's **shopping** domain.

## Document shape

```json
{
  "title": "Linen overshirt",
  "description": "Relaxed fit, stone wash.",
  "imageUrl": "https://cdn.example.com/p/123.jpg",
  "status": "published"
}
```

## Galya content produced

| Field | Value |
|-------|--------|
| `url` | `https://shop.example.com/products/{docId}` (stable dedup key) |
| `type` | `text` |
| `domain` | `shopping` |
| `content` | title + description (inline; `skipUrlFetch`) |
| `galyaEntityId` | Written back after sync for stable reindex |

Copy this file to your Functions root as `galya.sync.json`, set `GALYA_API_KEY`, deploy, then call `galyaBackfill` once.
