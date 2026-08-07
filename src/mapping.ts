import { createHash } from "node:crypto";
import { getFirestore } from "firebase-admin/firestore";
import type { SyncMapping } from "./types";

export const MAPPING_COLLECTION = "_galya_sync";

export function mappingDocId(source: "firestore" | "storage", sourceKey: string): string {
  const hash = createHash("sha256")
    .update(`${source}:${sourceKey}`)
    .digest("hex")
    .slice(0, 40);
  return hash;
}

export async function getMapping(
  source: "firestore" | "storage",
  sourceKey: string,
): Promise<(SyncMapping & { id: string }) | null> {
  const id = mappingDocId(source, sourceKey);
  const snap = await getFirestore().collection(MAPPING_COLLECTION).doc(id).get();
  if (!snap.exists) return null;
  return { id: snap.id, ...(snap.data() as SyncMapping) };
}

export async function upsertMapping(
  source: "firestore" | "storage",
  sourceKey: string,
  data: Omit<SyncMapping, "source" | "sourceKey" | "updatedAt" | "tombstoned"> & {
    tombstoned?: boolean;
  },
): Promise<string> {
  const id = mappingDocId(source, sourceKey);
  const payload: SyncMapping = {
    source,
    sourceKey,
    url: data.url,
    entityId: data.entityId,
    jobId: data.jobId,
    domain: data.domain,
    type: data.type,
    updatedAt: new Date().toISOString(),
    tombstoned: data.tombstoned ?? false,
  };
  await getFirestore().collection(MAPPING_COLLECTION).doc(id).set(payload, { merge: true });
  return id;
}

export async function tombstoneMapping(
  source: "firestore" | "storage",
  sourceKey: string,
): Promise<void> {
  const id = mappingDocId(source, sourceKey);
  const ref = getFirestore().collection(MAPPING_COLLECTION).doc(id);
  const snap = await ref.get();
  if (!snap.exists) return;
  await ref.set(
    {
      tombstoned: true,
      updatedAt: new Date().toISOString(),
    },
    { merge: true },
  );
}
