import * as fs from "node:fs";
import * as path from "node:path";
import type {
  CollectionSyncConfig,
  ContentDomain,
  ContentType,
  GalyaSyncConfig,
  StorageSyncConfig,
} from "./types";
import { CONTENT_DOMAINS } from "./types";

const DOMAIN_SET = new Set<string>(CONTENT_DOMAINS);

const CONTENT_TYPES = new Set<ContentType>(["image", "text", "audio", "video"]);

export type RuntimeEnv = {
  apiKey: string;
  workspaceId?: string;
  baseUrl: string;
};

let cachedConfig: GalyaSyncConfig | null = null;

function assertString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`galya.sync.json: ${label} must be a non-empty string`);
  }
  return value.trim();
}

function optionalDomain(value: unknown, label: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  const s = assertString(value, label).toLowerCase();
  if (!DOMAIN_SET.has(s)) {
    throw new Error(
      `galya.sync.json: ${label}="${s}" is not a known domain. Allowed: ${[...DOMAIN_SET].join(", ")}`,
    );
  }
  return s;
}

function optionalType(value: unknown, label: string): ContentType | undefined {
  if (value === undefined || value === null) return undefined;
  const s = assertString(value, label).toLowerCase() as ContentType;
  if (!CONTENT_TYPES.has(s)) {
    throw new Error(`galya.sync.json: ${label} must be image|text|audio|video`);
  }
  return s;
}

function validateCollection(raw: unknown, index: number): CollectionSyncConfig {
  if (!raw || typeof raw !== "object") {
    throw new Error(`galya.sync.json: collections[${index}] must be an object`);
  }
  const o = raw as Record<string, unknown>;
  const pathStr = assertString(o.path, `collections[${index}].path`);
  const url = assertString(o.url, `collections[${index}].url`);
  const cfg: CollectionSyncConfig = {
    path: pathStr,
    url,
    domain: optionalDomain(o.domain, `collections[${index}].domain`),
    type: optionalType(o.type, `collections[${index}].type`),
  };
  if (Array.isArray(o.fields)) {
    cfg.fields = o.fields.map((f, i) =>
      assertString(f, `collections[${index}].fields[${i}]`),
    );
  }
  if (typeof o.content === "string") cfg.content = o.content;
  if (typeof o.ref === "string") cfg.ref = o.ref;
  if (o.idField === null) cfg.idField = null;
  else if (typeof o.idField === "string") cfg.idField = o.idField;
  if (typeof o.writeBack === "boolean") cfg.writeBack = o.writeBack;
  if (typeof o.skipUrlFetch === "boolean") cfg.skipUrlFetch = o.skipUrlFetch;
  if (o.rules && typeof o.rules === "object") {
    const rules = o.rules as Record<string, unknown>;
    cfg.rules = {};
    if (rules.includeWhen && typeof rules.includeWhen === "object") {
      cfg.rules.includeWhen = rules.includeWhen as Record<string, unknown>;
    }
    if (rules.excludeWhen && typeof rules.excludeWhen === "object") {
      cfg.rules.excludeWhen = rules.excludeWhen as Record<string, unknown>;
    }
  }
  return cfg;
}

function validateStorage(raw: unknown, index: number): StorageSyncConfig {
  if (!raw || typeof raw !== "object") {
    throw new Error(`galya.sync.json: storage[${index}] must be an object`);
  }
  const o = raw as Record<string, unknown>;
  const pathPrefix = assertString(o.pathPrefix, `storage[${index}].pathPrefix`);
  const domain = optionalDomain(o.domain, `storage[${index}].domain`);
  if (!domain) {
    throw new Error(`galya.sync.json: storage[${index}].domain is required`);
  }
  const cfg: StorageSyncConfig = {
    pathPrefix: pathPrefix.endsWith("/") ? pathPrefix : `${pathPrefix}/`,
    domain,
    type: optionalType(o.type, `storage[${index}].type`) ?? "image",
  };
  if (typeof o.url === "string") cfg.url = o.url;
  if (Array.isArray(o.contentFromMetadata)) {
    cfg.contentFromMetadata = o.contentFromMetadata.map((f, i) =>
      assertString(f, `storage[${index}].contentFromMetadata[${i}]`),
    );
  }
  if (typeof o.writeBack === "boolean") cfg.writeBack = o.writeBack;
  if (o.rules && typeof o.rules === "object") {
    const rules = o.rules as Record<string, unknown>;
    cfg.rules = {};
    if (Array.isArray(rules.contentTypes)) {
      cfg.rules.contentTypes = rules.contentTypes.map((c, i) =>
        assertString(c, `storage[${index}].rules.contentTypes[${i}]`),
      );
    }
    if (typeof rules.minSizeBytes === "number") cfg.rules.minSizeBytes = rules.minSizeBytes;
    if (typeof rules.maxSizeBytes === "number") cfg.rules.maxSizeBytes = rules.maxSizeBytes;
  }
  return cfg;
}

export function parseSyncConfig(raw: unknown): GalyaSyncConfig {
  if (!raw || typeof raw !== "object") {
    throw new Error("galya.sync.json: root must be an object");
  }
  const o = raw as Record<string, unknown>;
  if (o.version !== 1) {
    throw new Error('galya.sync.json: "version" must be 1');
  }
  if (!Array.isArray(o.collections) || o.collections.length === 0) {
    throw new Error("galya.sync.json: collections must be a non-empty array");
  }
  const defaults =
    o.defaults && typeof o.defaults === "object"
      ? (o.defaults as Record<string, unknown>)
      : undefined;

  const config: GalyaSyncConfig = {
    version: 1,
    collections: o.collections.map(validateCollection),
  };

  if (defaults) {
    config.defaults = {
      domain: optionalDomain(defaults.domain, "defaults.domain"),
      type: optionalType(defaults.type, "defaults.type"),
      batchSize:
        typeof defaults.batchSize === "number" && defaults.batchSize > 0
          ? Math.min(200, Math.floor(defaults.batchSize))
          : undefined,
      skipUrlFetch:
        typeof defaults.skipUrlFetch === "boolean" ? defaults.skipUrlFetch : undefined,
      idField:
        defaults.idField === null
          ? null
          : typeof defaults.idField === "string"
            ? defaults.idField
            : undefined,
      writeBack:
        typeof defaults.writeBack === "boolean" ? defaults.writeBack : undefined,
    };
  }

  if (Array.isArray(o.storage)) {
    config.storage = o.storage.map(validateStorage);
  }

  for (const col of config.collections) {
    const domain = col.domain ?? config.defaults?.domain;
    if (!domain) {
      throw new Error(
        `galya.sync.json: collection "${col.path}" needs domain (or defaults.domain)`,
      );
    }
  }

  return config;
}

/** Resolve config path: GALYA_SYNC_CONFIG, ./galya.sync.json, or example. */
export function resolveConfigPath(): string {
  if (process.env.GALYA_SYNC_CONFIG?.trim()) {
    return path.resolve(process.env.GALYA_SYNC_CONFIG.trim());
  }
  const local = path.resolve(process.cwd(), "galya.sync.json");
  if (fs.existsSync(local)) return local;
  const example = path.resolve(process.cwd(), "galya.sync.example.json");
  if (fs.existsSync(example)) return example;
  throw new Error(
    "galya-firebase: missing galya.sync.json — copy galya.sync.example.json and configure collections",
  );
}

export function loadSyncConfig(forceReload = false): GalyaSyncConfig {
  if (cachedConfig && !forceReload) return cachedConfig;
  const filePath = resolveConfigPath();
  const text = fs.readFileSync(filePath, "utf8");
  cachedConfig = parseSyncConfig(JSON.parse(text) as unknown);
  return cachedConfig;
}

export function loadRuntimeEnv(): RuntimeEnv {
  const apiKey = (process.env.GALYA_API_KEY ?? "").trim();
  if (!apiKey) {
    throw new Error("galya-firebase: GALYA_API_KEY is required (galya_wsk_… or galya_sk_…)");
  }
  const workspaceId = (process.env.GALYA_WORKSPACE_ID ?? "").trim() || undefined;
  const baseUrl =
    (process.env.GALYA_BASE_URL ?? "").trim() || "https://api.galya.io/v1";
  return { apiKey, workspaceId, baseUrl };
}

/** Normalize domain aliases for Galya API. */
export function normalizeDomain(raw: string): ContentDomain | string {
  const key = raw.trim().toLowerCase().replace(/[\s/_-]+/g, "");
  if (key === "ux") return "uiux";
  if (key === "linkedin" || key === "career" || key === "careers") return "professional";
  if (key === "ecommerce") return "shopping";
  if (key === "restaurant") return "restaurants";
  return raw.trim().toLowerCase();
}

/**
 * Convert a config path like `users/{uid}/listings` into a Firestore trigger
 * document path `users/{uid}/listings/{docId}`.
 */
export function toDocumentTriggerPath(collectionPath: string): string {
  const trimmed = collectionPath.replace(/^\/+|\/+$/g, "");
  if (trimmed.includes("{documentId}") || /\/\{[^}]+\}$/.test(trimmed)) {
    return trimmed;
  }
  return `${trimmed}/{documentId}`;
}

/** Safe Cloud Function export name from a collection path. */
export function functionNameForCollection(collectionPath: string, index: number): string {
  const slug = collectionPath
    .replace(/\{[^}]+\}/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 40);
  return `galyaFs_${slug || "col"}_${index}`;
}

export function functionNameForStorage(prefix: string, index: number): string {
  const slug = prefix
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 40);
  return `galyaSt_${slug || "obj"}_${index}`;
}
