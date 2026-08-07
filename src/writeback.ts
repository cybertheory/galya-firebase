import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import type { CollectionSyncConfig, GalyaSyncDefaults } from "./types";
import { getPath } from "./rules";

/** Default Firestore field for Galya content entity id (read + write-back). */
export const DEFAULT_ENTITY_ID_FIELD = "galyaEntityId";

/** Internal timestamp written alongside the entity id (ignored for change detection). */
export const SYNCED_AT_FIELD = "galyaSyncedAt";

/**
 * Resolve the document field used to store / read the Galya entity id.
 * - omit / undefined → `galyaEntityId`
 * - `null` → disabled (no read, no write-back)
 * - string → that field path (supports `a.b`)
 */
export function resolveIdField(
  cfg: CollectionSyncConfig,
  defaults?: GalyaSyncDefaults,
): string | null {
  if (cfg.idField === null) return null;
  if (typeof cfg.idField === "string" && cfg.idField.trim()) {
    return cfg.idField.trim();
  }
  if (defaults?.idField === null) return null;
  if (typeof defaults?.idField === "string" && defaults.idField.trim()) {
    return defaults.idField.trim();
  }
  return DEFAULT_ENTITY_ID_FIELD;
}

export function writeBackEnabled(
  cfg: CollectionSyncConfig,
  defaults?: GalyaSyncDefaults,
): boolean {
  if (cfg.writeBack === false) return false;
  if (cfg.writeBack === true) return true;
  if (defaults?.writeBack === false) return false;
  return resolveIdField(cfg, defaults) !== null;
}

/** Fields the sync itself writes — never treat as content changes. */
export function syncManagedFields(
  cfg: CollectionSyncConfig,
  defaults?: GalyaSyncDefaults,
): string[] {
  const idField = resolveIdField(cfg, defaults);
  const out = [SYNCED_AT_FIELD];
  if (idField) out.push(idField);
  return out;
}

/**
 * True when the only differences are sync-managed write-back fields.
 */
export function isWritebackOnlyChange(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  managed: string[],
): boolean {
  return !contentFieldsDiffer(before, after, managed);
}

function contentFieldsDiffer(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  ignorePaths: string[],
): boolean {
  const allKeys = new Set([...flattenKeys(before), ...flattenKeys(after)]);
  for (const key of allKeys) {
    if (
      ignorePaths.some(
        (p) => key === p || key.startsWith(`${p}.`) || p.startsWith(`${key}.`),
      )
    ) {
      continue;
    }
    if (!valuesEqual(getPath(before, key), getPath(after, key))) return true;
  }
  return false;
}

function flattenKeys(obj: Record<string, unknown>, prefix = ""): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (
      v !== null &&
      typeof v === "object" &&
      !Array.isArray(v) &&
      !(v instanceof Date) &&
      typeof (v as { toDate?: unknown }).toDate !== "function"
    ) {
      out.push(...flattenKeys(v as Record<string, unknown>, path));
    } else {
      out.push(path);
    }
  }
  return out;
}

function valuesEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (a === null || b === null || a === undefined || b === undefined) return a === b;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

function firestoreUpdateForDotted(
  field: string,
  value: unknown,
): Record<string, unknown> {
  // Firestore update supports dotted paths as field names
  return { [field]: value };
}

/**
 * Write Galya entity id (+ syncedAt) onto the source Firestore document.
 * No-op if write-back disabled, missing entityId, or value already matches.
 */
export async function writeEntityIdToFirestoreDoc(opts: {
  docPath: string;
  idField: string | null;
  entityId: string | undefined;
  enabled: boolean;
  currentData?: Record<string, unknown>;
}): Promise<boolean> {
  if (!opts.enabled || !opts.idField || !opts.entityId) return false;
  const current = opts.currentData
    ? getPath(opts.currentData, opts.idField)
    : undefined;
  if (current === opts.entityId) return false;

  await getFirestore()
    .doc(opts.docPath)
    .update({
      ...firestoreUpdateForDotted(opts.idField, opts.entityId),
      [SYNCED_AT_FIELD]: new Date().toISOString(),
    });
  return true;
}

/** Clear entity id write-back fields after Galya delete / rule exclude. */
export async function clearEntityIdOnFirestoreDoc(opts: {
  docPath: string;
  idField: string | null;
  enabled: boolean;
}): Promise<void> {
  if (!opts.enabled || !opts.idField) return;
  await getFirestore()
    .doc(opts.docPath)
    .update({
      ...firestoreUpdateForDotted(opts.idField, FieldValue.delete()),
      [SYNCED_AT_FIELD]: FieldValue.delete(),
    });
}

const STORAGE_META_ENTITY_ID = "galyaEntityId";

/** Persist entity id on Storage object custom metadata for stable re-sync. */
export async function writeEntityIdToStorageObject(opts: {
  bucket: string;
  name: string;
  entityId: string | undefined;
  enabled?: boolean;
}): Promise<void> {
  if (opts.enabled === false || !opts.entityId) return;
  const file = getStorage().bucket(opts.bucket).file(opts.name);
  const [meta] = await file.getMetadata();
  const existing = { ...(meta.metadata ?? {}) } as Record<string, string>;
  if (existing[STORAGE_META_ENTITY_ID] === opts.entityId) return;
  existing[STORAGE_META_ENTITY_ID] = opts.entityId;
  await file.setMetadata({ metadata: existing });
}

export function readStorageEntityId(
  metadata: Record<string, unknown> | undefined,
): string | undefined {
  if (!metadata) return undefined;
  const v = metadata[STORAGE_META_ENTITY_ID];
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}
