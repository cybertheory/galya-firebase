# Changelog

## 1.1.0 — 2026-08-07

- Callable Galya ops: `galyaGauge`, `galyaSearch`, `galyaRerank`, `galyaRecommend`, `galyaAsk`, `galyaExplain`
- Entity callables: `galyaCreateEntity`, `galyaCreateEntityBatch`, `galyaGetEntity`, `galyaDeleteEntity`, `galyaLinkEntity`, `galyaGetEntityJob`

## 1.0.1 — 2026-08-07

- Write Galya `entityId` back onto source Firestore docs (`galyaEntityId` + `galyaSyncedAt` by default)
- Write `galyaEntityId` into Storage custom metadata
- Ignore write-back-only document updates to prevent sync loops
- Clear write-back fields when a doc becomes rule-excluded

## 1.0.0 — 2026-08-07

- Initial public release: Firestore + Storage → Galya content sync
- Multi-collection `galya.sync.json` config with field templates and rules
- Realtime `onDocumentWritten` / Storage finalize+delete triggers
- `galyaBackfill` callable for full reindex
- Mapping store in `_galya_sync` for delete cleanup via `deleteEntity`
