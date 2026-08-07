import type { CollectionSyncConfig, GalyaSyncDefaults, MappedContent, ContentType } from "./types";
import { normalizeDomain } from "./config";
import { getPath, pickFields, renderTemplate } from "./rules";
import { resolveIdField } from "./writeback";

function serializeFirestoreValue(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value !== "object") return value;
  if (typeof (value as { toDate?: unknown }).toDate === "function") {
    return (value as { toDate: () => Date }).toDate().toISOString();
  }
  if (
    typeof (value as { latitude?: unknown }).latitude === "number" &&
    typeof (value as { longitude?: unknown }).longitude === "number"
  ) {
    return {
      lat: (value as { latitude: number }).latitude,
      lng: (value as { longitude: number }).longitude,
    };
  }
  if (typeof (value as { path?: unknown }).path === "string") {
    return (value as { path: string }).path;
  }
  if (Array.isArray(value)) {
    return value.map(serializeFirestoreValue);
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = serializeFirestoreValue(v);
  }
  return out;
}

export function firestoreDocToPlain(
  data: Record<string, unknown>,
): Record<string, unknown> {
  return serializeFirestoreValue(data) as Record<string, unknown>;
}

export function mapFirestoreDoc(opts: {
  cfg: CollectionSyncConfig;
  defaults?: GalyaSyncDefaults;
  docId: string;
  docPath: string;
  data: Record<string, unknown>;
}): MappedContent {
  const { cfg, defaults, docId, docPath, data } = opts;
  const picked = pickFields(data, cfg.fields);
  const ctx: Record<string, unknown> = {
    ...picked,
    id: docId,
    path: docPath,
  };

  const url = renderTemplate(cfg.url, ctx).trim();
  if (!url) {
    throw new Error(
      `galya-firebase: collection "${cfg.path}" produced empty url (template: ${cfg.url})`,
    );
  }

  const type = (cfg.type ?? defaults?.type ?? "text") as ContentType;
  const domain = normalizeDomain(
    String(cfg.domain ?? defaults?.domain ?? "shopping"),
  );

  let content: string | undefined;
  if (cfg.content) {
    content = renderTemplate(cfg.content, ctx).trim() || undefined;
  }

  let ref: string | undefined;
  if (cfg.ref) {
    ref = renderTemplate(cfg.ref, ctx).trim() || undefined;
  }

  const idField = resolveIdField(cfg, defaults);
  let existingEntityId: string | null | undefined;
  if (idField) {
    const raw = getPath(data, idField);
    existingEntityId = typeof raw === "string" && raw.trim() ? raw.trim() : null;
  }

  const skipUrlFetch =
    cfg.skipUrlFetch ??
    defaults?.skipUrlFetch ??
    (type === "text" && Boolean(content));

  return {
    url,
    type,
    domain,
    content,
    ref,
    skip_url_fetch: skipUrlFetch || undefined,
    existingEntityId,
  };
}

export function contentTypeFromMime(
  mime: string | undefined,
  fallback: ContentType,
): ContentType {
  if (!mime) return fallback;
  const m = mime.toLowerCase();
  if (m.startsWith("image/")) return "image";
  if (m.startsWith("video/")) return "video";
  if (m.startsWith("audio/")) return "audio";
  if (m.startsWith("text/") || m.includes("json") || m.includes("html")) return "text";
  return fallback;
}

export function mapStorageObject(opts: {
  domain: string;
  type: ContentType;
  url: string;
  content?: string;
  existingEntityId?: string;
}): MappedContent {
  return {
    url: opts.url,
    type: opts.type,
    domain: normalizeDomain(opts.domain),
    content: opts.content,
    skip_url_fetch: false,
    existingEntityId: opts.existingEntityId,
  };
}
