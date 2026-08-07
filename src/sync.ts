import { GalyaClient, type ContentObject } from "./galyaClient";
import { loadRuntimeEnv } from "./config";
import { getMapping, tombstoneMapping, upsertMapping } from "./mapping";
import type { MappedContent } from "./types";

let client: GalyaClient | null = null;

export function getGalyaClient(): GalyaClient {
  if (client) return client;
  const env = loadRuntimeEnv();
  client = new GalyaClient({
    apiKey: env.apiKey,
    workspaceId: env.workspaceId,
    baseUrl: env.baseUrl,
  });
  return client;
}

/** Reset cached client after secrets are applied (or in tests). */
export function resetGalyaClient(): void {
  client = null;
}

function toContentObject(mapped: MappedContent): ContentObject {
  const content: ContentObject = {
    url: mapped.url,
    type: mapped.type,
    domain: mapped.domain,
  };
  if (mapped.content) content.content = mapped.content;
  if (mapped.skip_url_fetch) content.skip_url_fetch = true;
  if (mapped.existingEntityId) content.id = mapped.existingEntityId;
  if (mapped.ref) content.ref = mapped.ref;
  return content;
}

export type UpsertResult = {
  entityId?: string;
  jobId?: string;
  created?: boolean;
};

export async function upsertContent(opts: {
  source: "firestore" | "storage";
  sourceKey: string;
  mapped: MappedContent;
  waitForJob?: boolean;
}): Promise<UpsertResult> {
  const api = getGalyaClient();
  const prior = await getMapping(opts.source, opts.sourceKey);
  const content = toContentObject(opts.mapped);

  const entityIdHint = opts.mapped.existingEntityId ?? prior?.entityId ?? undefined;

  const accepted = await api.createEntity({
    content,
    id: entityIdHint,
  });

  let entityId: string | undefined =
    typeof accepted.entity_id === "string"
      ? accepted.entity_id
      : typeof accepted.id === "string"
        ? accepted.id
        : undefined;
  let jobId: string | undefined =
    typeof accepted.job_id === "string" && accepted.job_id.trim()
      ? accepted.job_id
      : undefined;

  if (jobId && opts.waitForJob !== false) {
    const done = await api.waitForEntityJob(jobId, {
      intervalMs: 2000,
      timeoutMs: 10 * 60_000,
    });
    const first = done.results?.[0];
    if (first?.entity_id) entityId = first.entity_id;
  }

  await upsertMapping(opts.source, opts.sourceKey, {
    url: opts.mapped.url,
    entityId,
    jobId,
    domain: opts.mapped.domain,
    type: opts.mapped.type,
    tombstoned: false,
  });

  return { entityId, jobId, created: true };
}

export async function upsertContentBatch(opts: {
  source: "firestore" | "storage";
  items: Array<{ sourceKey: string; mapped: MappedContent }>;
  waitForJob?: boolean;
}): Promise<{ jobId?: string; results: UpsertResult[] }> {
  if (opts.items.length === 0) return { results: [] };

  const api = getGalyaClient();
  const content = opts.items.map((i) => toContentObject(i.mapped));
  const ids = await Promise.all(
    opts.items.map(async (i) => {
      if (i.mapped.existingEntityId) return i.mapped.existingEntityId;
      const prior = await getMapping(opts.source, i.sourceKey);
      return prior?.entityId ?? null;
    }),
  );

  const accepted = await api.createEntityBatch({ content, ids });
  const jobId =
    "job_id" in accepted && typeof accepted.job_id === "string"
      ? accepted.job_id
      : undefined;

  let results: Array<{ entity_id: string; created: boolean }> = [];
  if (jobId && opts.waitForJob !== false) {
    const done = await api.waitForEntityJob(jobId, {
      intervalMs: 2000,
      timeoutMs: 20 * 60_000,
    });
    results = done.results ?? [];
  } else if ("results" in accepted && Array.isArray(accepted.results)) {
    results = accepted.results;
  }

  const out: UpsertResult[] = [];
  for (let i = 0; i < opts.items.length; i++) {
    const item = opts.items[i]!;
    const row = results[i];
    const entityId = row?.entity_id;
    await upsertMapping(opts.source, item.sourceKey, {
      url: item.mapped.url,
      entityId,
      jobId,
      domain: item.mapped.domain,
      type: item.mapped.type,
      tombstoned: false,
    });
    out.push({ entityId, jobId, created: row?.created });
  }

  return { jobId, results: out };
}

export async function deleteSyncedContent(opts: {
  source: "firestore" | "storage";
  sourceKey: string;
}): Promise<{ deleted: boolean; entityId?: string }> {
  const prior = await getMapping(opts.source, opts.sourceKey);
  if (!prior?.entityId) {
    await tombstoneMapping(opts.source, opts.sourceKey);
    return { deleted: false };
  }

  try {
    await getGalyaClient().deleteEntity(prior.entityId);
  } catch (err) {
    console.error("galya-firebase: deleteEntity failed", prior.entityId, err);
  }

  await tombstoneMapping(opts.source, opts.sourceKey);
  return { deleted: true, entityId: prior.entityId };
}
