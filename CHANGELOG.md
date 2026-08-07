# Changelog

## 1.0.0 — 2026-08-07

- Initial public release: Firestore + Storage → Galya content sync
- Multi-collection `galya.sync.json` config with field templates and rules
- Realtime `onDocumentWritten` / Storage finalize+delete triggers
- `galyaBackfill` callable for full reindex
- Mapping store in `_galya_sync` for delete cleanup via `deleteEntity`
