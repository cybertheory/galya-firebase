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
import {
  clearEntityIdOnFirestoreDoc,
  isWritebackOnlyChange,
  resolveIdField,
  syncManagedFields,
  writeBackEnabled,
  writeEntityIdToFirestoreDoc,
} from "./writeback";

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

    const idField = resolveIdField(cfg, defaults);
    const doWriteBack = writeBackEnabled(cfg, defaults);
    const managed = syncManagedFields(cfg, defaults);

    if (beforeData && !afterData) {
      await deleteSyncedContent({ source: "firestore", sourceKey: docPath });
      return;
    }

    if (!afterData) return;

    // Ignore our own write-back updates (entity id / syncedAt only).
    if (beforeData && isWritebackOnlyChange(beforeData, afterData, managed)) {
      return;
    }

    const include = shouldInclude(afterData, cfg.rules);
    const wasIncluded = beforeData ? shouldInclude(beforeData, cfg.rules) : false;

    if (!include) {
      // Only delete when transitioning from included → excluded (not on every edit to an excluded doc).
      if (wasIncluded) {
        await deleteSyncedContent({ source: "firestore", sourceKey: docPath });
        try {
          await clearEntityIdOnFirestoreDoc({
            docPath,
            idField,
            enabled: doWriteBack,
          });
        } catch (err) {
          console.warn("galya-firebase: clear entity id write-back failed", docPath, err);
        }
      }
      return;
    }

    if (beforeData) {
      const watchFields = (cfg.fields ?? []).filter((f) => !managed.includes(f));
      const dataChanged = fieldsChanged(
        beforeData,
        afterData,
        // Empty allowlist → all fields; write-back-only updates already returned above.
        cfg.fields && cfg.fields.length > 0 ? watchFields : undefined,
      );
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

    const result = await upsertContent({
      source: "firestore",
      sourceKey: docPath,
      mapped,
      waitForJob: true,
    });

    try {
      await writeEntityIdToFirestoreDoc({
        docPath,
        idField,
        entityId: result.entityId,
        enabled: doWriteBack,
        currentData: afterData,
      });
    } catch (err) {
      console.error("galya-firebase: entity id write-back failed", docPath, err);
    }
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
