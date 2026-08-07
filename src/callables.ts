import { onCall, HttpsError, type CallableRequest } from "firebase-functions/v2/https";
import { GalyaApiError, type ContentObject, type RelativeParams } from "./galyaClient";
import { applyGalyaEnvFromParams, secretBindings } from "./params";
import { getGalyaClient, resetGalyaClient } from "./sync";

function requireAuth(request: CallableRequest): void {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Sign in required");
  }
}

function mapError(err: unknown, fallback: string): HttpsError {
  if (err instanceof HttpsError) return err;
  if (err instanceof GalyaApiError) {
    if (err.status === 400 || err.status === 422) {
      return new HttpsError("invalid-argument", err.message);
    }
    if (err.status === 401 || err.status === 403) {
      return new HttpsError("permission-denied", err.message);
    }
    if (err.status === 404) {
      return new HttpsError("not-found", err.message);
    }
    if (err.status === 408 || err.status === 429) {
      return new HttpsError("resource-exhausted", err.message);
    }
    return new HttpsError("internal", err.message);
  }
  return new HttpsError(
    "internal",
    err instanceof Error ? err.message : fallback,
  );
}

function str(v: unknown, label: string): string {
  if (typeof v !== "string" || !v.trim()) {
    throw new HttpsError("invalid-argument", `${label} is required`);
  }
  return v.trim();
}

function relativeParams(data: Record<string, unknown>): RelativeParams {
  return {
    relativeToEntityId: str(
      data.relativeToEntityId ?? data.relative_to_entity_id,
      "relativeToEntityId",
    ),
    inTermsOfEntityType: str(
      data.inTermsOfEntityType ?? data.in_terms_of_entity_type,
      "inTermsOfEntityType",
    ),
    domain:
      typeof data.domain === "string" && data.domain.trim()
        ? data.domain.trim()
        : undefined,
    task:
      typeof data.task === "string" && data.task.trim() ? data.task.trim() : undefined,
  };
}

function withGalyaClient<T>(
  name: string,
  handler: (data: Record<string, unknown>) => Promise<T>,
  opts?: { timeoutSeconds?: number; memory?: "256MiB" | "512MiB" | "1GiB" },
) {
  return onCall(
    {
      timeoutSeconds: opts?.timeoutSeconds ?? 120,
      memory: opts?.memory ?? "512MiB",
      secrets: secretBindings(),
    },
    async (request) => {
      applyGalyaEnvFromParams();
      resetGalyaClient();
      requireAuth(request);
      try {
        return await handler((request.data ?? {}) as Record<string, unknown>);
      } catch (err) {
        console.error(`galya-firebase: ${name} failed`, err);
        throw mapError(err, `${name} failed`);
      }
    },
  );
}

/** Score agent reply resonance given the next user turn. */
export const galyaGauge = withGalyaClient("galyaGauge", async (data) => {
  const response = str(data.response, "response");
  const followup = str(data.followup, "followup");
  const prompt =
    typeof data.prompt === "string" && data.prompt.trim()
      ? data.prompt.trim()
      : undefined;
  return getGalyaClient().gauge({ response, followup, prompt });
});

/** Personalized search relative to an entity. */
export const galyaSearch = withGalyaClient("galyaSearch", async (data) => {
  const params = relativeParams(data);
  const query = str(data.query, "query");
  const additional_candidates = Array.isArray(data.additional_candidates)
    ? (data.additional_candidates as ContentObject[])
    : undefined;
  return getGalyaClient().search(params, { query, additional_candidates });
});

/** Rerank candidates relative to an entity (optional domain / history). */
export const galyaRerank = withGalyaClient("galyaRerank", async (data) => {
  const params = relativeParams(data);
  if (!Array.isArray(data.candidates) || data.candidates.length === 0) {
    throw new HttpsError("invalid-argument", "candidates must be a non-empty array");
  }
  return getGalyaClient().rerank(params, {
    candidates: data.candidates as Array<ContentObject | string>,
    history: Array.isArray(data.history) ? (data.history as string[]) : undefined,
    item_texts:
      data.item_texts && typeof data.item_texts === "object"
        ? (data.item_texts as Record<string, string>)
        : undefined,
    item_images:
      data.item_images && typeof data.item_images === "object"
        ? (data.item_images as Record<string, string>)
        : undefined,
  });
});

/** Recommend from candidates + engagement history. */
export const galyaRecommend = withGalyaClient("galyaRecommend", async (data) => {
  const params = relativeParams(data);
  if (!Array.isArray(data.candidates) || data.candidates.length === 0) {
    throw new HttpsError("invalid-argument", "candidates must be a non-empty array");
  }
  if (!Array.isArray(data.history) || data.history.length === 0) {
    throw new HttpsError("invalid-argument", "history must be a non-empty array");
  }
  return getGalyaClient().recommend(params, {
    candidates: data.candidates as Array<ContentObject | string>,
    history: data.history as string[],
    item_texts:
      data.item_texts && typeof data.item_texts === "object"
        ? (data.item_texts as Record<string, string>)
        : undefined,
    item_images:
      data.item_images && typeof data.item_images === "object"
        ? (data.item_images as Record<string, string>)
        : undefined,
  });
});

/** Natural-language ask relative to an entity. */
export const galyaAsk = withGalyaClient("galyaAsk", async (data) => {
  const params = relativeParams(data);
  const query = str(data.query, "query");
  return getGalyaClient().ask(params, { query });
});

/** Explain a query relative to an entity. */
export const galyaExplain = withGalyaClient("galyaExplain", async (data) => {
  const params = relativeParams(data);
  const query = str(data.query, "query");
  return getGalyaClient().explain(params, { query });
});

/**
 * Create / upsert an entity.
 * Content: `{ content: ContentObject, id?, force_reindex? }`
 * Parent: `{ type, name, description?, linked_content? }`
 * Attach: `{ id: parentId, linked_content: ContentObject[] }`
 */
export const galyaCreateEntity = withGalyaClient(
  "galyaCreateEntity",
  async (data) => {
    const api = getGalyaClient();
    const result = await api.createEntity({
      content: data.content as ContentObject | undefined,
      id: typeof data.id === "string" ? data.id : undefined,
      force_reindex:
        typeof data.force_reindex === "boolean" ? data.force_reindex : undefined,
      type: typeof data.type === "string" ? data.type : undefined,
      name: typeof data.name === "string" ? data.name : undefined,
      description:
        typeof data.description === "string" ? data.description : undefined,
      linked_content: Array.isArray(data.linked_content)
        ? (data.linked_content as ContentObject[])
        : undefined,
    });
    const jobId =
      typeof result.job_id === "string" && result.job_id.trim()
        ? result.job_id
        : undefined;
    if (jobId && data.wait !== false) {
      const done = await api.waitForEntityJob(jobId);
      return { ...result, job: done };
    }
    return result;
  },
  { timeoutSeconds: 300, memory: "1GiB" },
);

/** Batch upsert content entities. */
export const galyaCreateEntityBatch = withGalyaClient(
  "galyaCreateEntityBatch",
  async (data) => {
    if (!Array.isArray(data.content) || data.content.length === 0) {
      throw new HttpsError("invalid-argument", "content must be a non-empty array");
    }
    const api = getGalyaClient();
    const accepted = await api.createEntityBatch({
      content: data.content as ContentObject[],
      ids: Array.isArray(data.ids) ? (data.ids as (string | null)[]) : undefined,
    });
    const jobId =
      "job_id" in accepted && typeof accepted.job_id === "string"
        ? accepted.job_id
        : undefined;
    if (jobId && data.wait !== false) {
      const done = await api.waitForEntityJob(jobId);
      return { job_id: jobId, ...done };
    }
    return accepted;
  },
  { timeoutSeconds: 540, memory: "1GiB" },
);

/** Poll an async entity/batch job. */
export const galyaGetEntityJob = withGalyaClient("galyaGetEntityJob", async (data) => {
  const jobId = str(data.job_id ?? data.jobId, "job_id");
  return getGalyaClient().getEntityBatchJob(jobId);
});

/** Fetch an entity by id. */
export const galyaGetEntity = withGalyaClient("galyaGetEntity", async (data) => {
  const entityId = str(data.entity_id ?? data.entityId, "entity_id");
  return getGalyaClient().getEntity(entityId);
});

/** Delete an entity by id. */
export const galyaDeleteEntity = withGalyaClient("galyaDeleteEntity", async (data) => {
  const entityId = str(data.entity_id ?? data.entityId, "entity_id");
  return getGalyaClient().deleteEntity(entityId);
});

/**
 * Link a child entity to a parent and mean-pool.
 * `{ parent_id, entity_id, rel?, weight? }`
 */
export const galyaLinkEntity = withGalyaClient("galyaLinkEntity", async (data) => {
  const parentId = str(data.parent_id ?? data.parentId, "parent_id");
  const entityId = str(data.entity_id ?? data.entityId, "entity_id");
  const rel = typeof data.rel === "string" ? data.rel : undefined;
  const weight = typeof data.weight === "number" ? data.weight : undefined;
  return getGalyaClient().linkEntity(parentId, {
    entity_id: entityId,
    rel,
    weight,
  });
});
