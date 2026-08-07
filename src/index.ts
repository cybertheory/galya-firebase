import { initializeApp } from "firebase-admin/app";
import {
  functionNameForCollection,
  functionNameForStorage,
  loadSyncConfig,
  toDocumentTriggerPath,
} from "./config";
import { buildFirestoreFunction } from "./firestore";
import { buildStorageFunctions } from "./storage";
import { galyaBackfill } from "./backfill";

initializeApp();

const config = loadSyncConfig();

const triggers: Record<string, unknown> = {
  galyaBackfill,
};

config.collections.forEach((col, index) => {
  const name = functionNameForCollection(col.path, index);
  const documentPath = toDocumentTriggerPath(col.path);
  triggers[name] = buildFirestoreFunction(name, documentPath, col, config.defaults);
});

(config.storage ?? []).forEach((st, index) => {
  const base = functionNameForStorage(st.pathPrefix, index);
  const pair = buildStorageFunctions(base, st);
  triggers[`${base}_finalized`] = pair.finalized;
  triggers[`${base}_deleted`] = pair.deleted;
});

export = triggers;
