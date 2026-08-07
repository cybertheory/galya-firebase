import { getStorage } from "firebase-admin/storage";
import {
  onObjectDeleted,
  onObjectFinalized,
  type StorageEvent,
} from "firebase-functions/v2/storage";
import type { StorageSyncConfig } from "./types";
import { getPath, renderTemplate } from "./rules";
import { contentTypeFromMime, mapStorageObject } from "./map";
import { applyGalyaEnvFromParams, secretBindings } from "./params";
import { deleteSyncedContent, resetGalyaClient, upsertContent } from "./sync";

function matchesPrefix(objectName: string, prefix: string): boolean {
  return objectName.startsWith(prefix);
}

function passesStorageRules(
  cfg: StorageSyncConfig,
  contentType: string | undefined,
  size: number | undefined,
): boolean {
  const rules = cfg.rules;
  if (!rules) return true;
  if (rules.contentTypes?.length) {
    const ct = (contentType ?? "").toLowerCase();
    if (
      !rules.contentTypes.some(
        (a) => ct === a.toLowerCase() || ct.startsWith(a.toLowerCase()),
      )
    ) {
      return false;
    }
  }
  if (typeof rules.minSizeBytes === "number" && (size ?? 0) < rules.minSizeBytes) {
    return false;
  }
  if (typeof rules.maxSizeBytes === "number" && (size ?? 0) > rules.maxSizeBytes) {
    return false;
  }
  return true;
}

async function resolveDownloadUrl(bucket: string, name: string): Promise<string> {
  const file = getStorage().bucket(bucket).file(name);
  const [meta] = await file.getMetadata();
  const tokensRaw = meta.metadata?.firebaseStorageDownloadTokens;
  if (typeof tokensRaw === "string" && tokensRaw.trim()) {
    const token = tokensRaw.split(",")[0]!.trim();
    const encoded = encodeURIComponent(name);
    return `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encoded}?alt=media&token=${token}`;
  }
  const [signed] = await file.getSignedUrl({
    action: "read",
    expires: Date.now() + 7 * 24 * 60 * 60 * 1000,
  });
  return signed;
}

function metadataCaption(
  cfg: StorageSyncConfig,
  meta: Record<string, unknown>,
): string | undefined {
  if (!cfg.contentFromMetadata?.length) return undefined;
  const parts: string[] = [];
  for (const path of cfg.contentFromMetadata) {
    const v = getPath(meta, path);
    if (typeof v === "string" && v.trim()) parts.push(v.trim());
  }
  return parts.length ? parts.join("\n") : undefined;
}

export function createStorageFinalizeHandler(cfg: StorageSyncConfig) {
  return async (event: StorageEvent): Promise<void> => {
    applyGalyaEnvFromParams();
    resetGalyaClient();
    const object = event.data;
    const name = object.name;
    if (!name || !matchesPrefix(name, cfg.pathPrefix)) return;

    const contentType = object.contentType;
    const size = object.size ? Number(object.size) : undefined;
    if (!passesStorageRules(cfg, contentType, size)) return;

    const bucket = object.bucket;
    let url: string;
    if (!cfg.url || cfg.url === "downloadUrl") {
      url = await resolveDownloadUrl(bucket, name);
    } else {
      url = renderTemplate(cfg.url, {
        name,
        bucket,
        contentType: contentType ?? "",
        size: size ?? 0,
        id: name,
        path: name,
      }).trim();
    }
    if (!url) {
      console.warn("galya-firebase: storage object produced empty url", name);
      return;
    }

    const type = contentTypeFromMime(contentType, cfg.type ?? "image");
    const customMeta = (object.metadata ?? {}) as Record<string, unknown>;
    const content = metadataCaption(cfg, {
      customMetadata: customMeta,
      metadata: customMeta,
      name,
      bucket,
      contentType,
    });

    const mapped = mapStorageObject({
      domain: cfg.domain,
      type,
      url,
      content,
    });

    await upsertContent({
      source: "storage",
      sourceKey: `gs://${bucket}/${name}`,
      mapped,
      waitForJob: true,
    });
  };
}

export function createStorageDeleteHandler(cfg: StorageSyncConfig) {
  return async (event: StorageEvent): Promise<void> => {
    applyGalyaEnvFromParams();
    resetGalyaClient();
    const object = event.data;
    const name = object.name;
    if (!name || !matchesPrefix(name, cfg.pathPrefix)) return;
    const bucket = object.bucket;
    await deleteSyncedContent({
      source: "storage",
      sourceKey: `gs://${bucket}/${name}`,
    });
  };
}

export function buildStorageFunctions(exportBase: string, cfg: StorageSyncConfig) {
  return {
    finalized: onObjectFinalized(
      { retry: false, secrets: secretBindings() },
      createStorageFinalizeHandler(cfg),
    ),
    deleted: onObjectDeleted(
      { retry: false, secrets: secretBindings() },
      createStorageDeleteHandler(cfg),
    ),
    exportBase,
  };
}
