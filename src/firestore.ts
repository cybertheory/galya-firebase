import {
  onDocumentWritten,
  type FirestoreEvent,
  type Change,
  type DocumentSnapshot,
} from "firebase-functions/v2/firestore";
import type { CollectionSyncConfig, GalyaSyncDefaults } from "./types";
import { firestoreDocToPlain, mapFirestoreDoc } from "./map";
import {
  fieldsChanged,
  ruleFieldsChanged,
  shouldInclude,
} from "./rules";
import { applyGalyaEnvFromParams, secretBindings } from "./params";
import { deleteSyncedContent, resetGalyaClient, upsertContent } from "./sync";

export function createFirestoreSyncHandler(
  cfg: CollectionSyncConfig,
  defaults?: GalyaSyncDefaults,
) {
  return async (
    event: FirestoreEvent<
      Change<DocumentSnapshot> | undefined,
      Record<string, string>
    >,
  ): Promise<void> => {
    applyGalyaEnvFromParams();
    resetGalyaClient();
    const change = event.data;
    if (!change) return;

    const beforeSnap = change.before;
    const afterSnap = change.after;
    const docPath = afterSnap?.ref?.path ?? beforeSnap?.ref?.path;
    const docId = afterSnap?.id ?? beforeSnap?.id;
    if (!docPath || !docId) return;

    const beforeData = beforeSnap?.exists
      ? firestoreDocToPlain(beforeSnap.data() as Record<string, unknown>)
      : undefined;
    const afterData = afterSnap?.exists
      ? firestoreDocToPlain(afterSnap.data() as Record<string, unknown>)
      : undefined;

    if (beforeData && !afterData) {
      await deleteSyncedContent({ source: "firestore", sourceKey: docPath });
      return;
    }

    if (!afterData) return;

    const include = shouldInclude(afterData, cfg.rules);
    const wasIncluded = beforeData ? shouldInclude(beforeData, cfg.rules) : false;

    if (!include) {
      if (wasIncluded || beforeData) {
        await deleteSyncedContent({ source: "firestore", sourceKey: docPath });
      }
      return;
    }

    if (beforeData) {
      const dataChanged = fieldsChanged(beforeData, afterData, cfg.fields);
      const rulesChanged = ruleFieldsChanged(beforeData, afterData, cfg);
      if (!dataChanged && !rulesChanged) {
        return;
      }
    }

    const mapped = mapFirestoreDoc({
      cfg,
      defaults,
      docId,
      docPath,
      data: afterData,
    });

    await upsertContent({
      source: "firestore",
      sourceKey: docPath,
      mapped,
      waitForJob: true,
    });
  };
}

export function buildFirestoreFunction(
  _exportName: string,
  documentPath: string,
  cfg: CollectionSyncConfig,
  defaults?: GalyaSyncDefaults,
) {
  return onDocumentWritten(
    {
      document: documentPath,
      retry: false,
      secrets: secretBindings(),
    },
    createFirestoreSyncHandler(cfg, defaults),
  );
}
