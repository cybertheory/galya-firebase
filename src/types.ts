/** Galya catalog domains (schema + API aliases). */
export const CONTENT_DOMAINS = [
  "uiux",
  "professional",
  "shopping",
  "fashion",
  "restaurants",
  "travel",
  "hospitality",
  "ecommerce",
  "conversation",
  "linkedin",
] as const;

export type ContentDomain = (typeof CONTENT_DOMAINS)[number];

export type ContentType = "image" | "text" | "audio" | "video";

export type CollectionRules = {
  /** Shallow equality: all keys must match document fields. */
  includeWhen?: Record<string, unknown>;
  /** Shallow equality: if any key matches, exclude (and delete prior sync). */
  excludeWhen?: Record<string, unknown>;
};

export type CollectionSyncConfig = {
  /** Firestore collection path, e.g. `products` or `users/{uid}/listings`. */
  path: string;
  domain?: ContentDomain | string;
  type?: ContentType;
  /** Field allowlist; omit or empty = all top-level fields. */
  fields?: string[];
  /**
   * Mustache template for Galya content URL (dedup key).
   * e.g. `{{imageUrl}}` or `https://example.com/p/{{id}}`
   */
  url: string;
  /** Mustache template for inline content / embed text. */
  content?: string;
  /** Optional Galya correlation `ref` template. */
  ref?: string;
  /**
   * Firestore field for the Galya content entity id (read + write-back).
   * Default: `galyaEntityId`. Set `null` to disable.
   */
  idField?: string | null;
  /**
   * Write `idField` (+ `galyaSyncedAt`) onto the source doc after upsert.
   * Default: true when `idField` is enabled.
   */
  writeBack?: boolean;
  /**
   * When true (default for text with enough content), set skip_url_fetch.
   * Override explicitly if Galya should GET the url.
   */
  skipUrlFetch?: boolean;
  rules?: CollectionRules;
};

export type StorageRules = {
  contentTypes?: string[];
  minSizeBytes?: number;
  maxSizeBytes?: number;
};

export type StorageSyncConfig = {
  /** Object name prefix, e.g. `catalog/images/`. */
  pathPrefix: string;
  domain: ContentDomain | string;
  type?: ContentType;
  /**
   * How to build the Galya url:
   * - `downloadUrl` (default): Firebase download URL
   * - or a mustache template over metadata (`{{name}}`, `{{bucket}}`, …)
   */
  url?: "downloadUrl" | string;
  /** Dot-paths under object metadata for caption/notes → content. */
  contentFromMetadata?: string[];
  /**
   * Write `galyaEntityId` into Storage custom metadata after upsert.
   * Default: true.
   */
  writeBack?: boolean;
  rules?: StorageRules;
};

export type GalyaSyncDefaults = {
  domain?: ContentDomain | string;
  type?: ContentType;
  batchSize?: number;
  skipUrlFetch?: boolean;
  /** Default id field for collections (default `galyaEntityId`; `null` disables). */
  idField?: string | null;
  /** Default write-back for collections (default true when idField enabled). */
  writeBack?: boolean;
};

export type GalyaSyncConfig = {
  version: 1;
  defaults?: GalyaSyncDefaults;
  collections: CollectionSyncConfig[];
  storage?: StorageSyncConfig[];
};

export type SyncMapping = {
  source: "firestore" | "storage";
  sourceKey: string;
  url: string;
  entityId?: string;
  jobId?: string;
  domain: string;
  type: ContentType;
  updatedAt: string;
  tombstoned?: boolean;
};

export type MappedContent = {
  url: string;
  type: ContentType;
  domain: string;
  content?: string;
  ref?: string;
  skip_url_fetch?: boolean;
  existingEntityId?: string | null;
};
