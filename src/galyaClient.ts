/**
 * Minimal Galya content API client for Cloud Functions.
 * Mirrors the subset of @galya/agents used by this sync (create / batch / poll / delete).
 * Kept in-repo so the clone template works against the live API without waiting on npm.
 */

export type ContentType = "image" | "text" | "audio" | "video";

export type ContentObject = {
  id?: string;
  url: string;
  type: ContentType;
  domain: string;
  content?: string;
  skip_url_fetch?: boolean;
  skip_media_enrich?: boolean;
  ref?: string;
};

export type CreateEntityBatchJobAccepted = {
  job_id: string;
  job_arn?: string;
  status: string;
  status_path?: string;
  id?: string;
  entity_id?: string;
};

export type EntityJobPollResult = {
  job_id: string;
  status: string;
  results?: Array<{ entity_id: string; created: boolean; url?: string }>;
};

export type GalyaClientOptions = {
  apiKey: string;
  workspaceId?: string;
  baseUrl?: string;
  fetch?: typeof fetch;
};

function trimSlash(s: string): string {
  return s.replace(/\/+$/, "");
}

function galyaApiV1BaseUrl(input: string): string {
  const t = input.trim();
  if (!t) throw new Error("galyaClient: empty baseUrl");
  const noTrail = trimSlash(t);
  return noTrail.endsWith("/v1") ? noTrail : `${noTrail}/v1`;
}

export class GalyaApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
    readonly body?: unknown,
  ) {
    super(message);
    this.name = "GalyaApiError";
  }
}

export class GalyaClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly workspaceId?: string;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: GalyaClientOptions) {
    const apiKey = opts.apiKey.trim();
    if (!apiKey) throw new Error("GalyaClient: apiKey is required");
    this.apiKey = apiKey;
    this.workspaceId = opts.workspaceId?.trim() || undefined;
    this.baseUrl = galyaApiV1BaseUrl(opts.baseUrl ?? "https://api.galya.io/v1");
    this.fetchImpl = opts.fetch ?? globalThis.fetch.bind(globalThis);
  }

  private async request<T>(
    method: string,
    path: string,
    init?: { query?: Record<string, string | undefined>; body?: unknown },
  ): Promise<T> {
    let url = `${trimSlash(this.baseUrl)}${path.startsWith("/") ? path : `/${path}`}`;
    if (init?.query) {
      const u = new URL(url);
      for (const [k, v] of Object.entries(init.query)) {
        if (v !== undefined && v !== "") u.searchParams.set(k, v);
      }
      url = u.toString();
    }
    const headers: Record<string, string> = {
      "X-API-Key": this.apiKey,
      Accept: "application/json",
    };
    if (this.workspaceId) headers["X-Galya-Workspace-Id"] = this.workspaceId;
    let body: string | undefined;
    if (init?.body !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(init.body);
    }
    const res = await this.fetchImpl(url, { method, headers, body });
    const text = await res.text();
    let parsed: unknown = null;
    if (text) {
      try {
        parsed = JSON.parse(text) as unknown;
      } catch {
        parsed = text;
      }
    }
    if (!res.ok) {
      const msg =
        parsed && typeof parsed === "object" && parsed !== null && "error" in parsed
          ? String((parsed as { error: unknown }).error)
          : `Galya API ${res.status}`;
      throw new GalyaApiError(msg, res.status, undefined, parsed);
    }
    return parsed as T;
  }

  async createEntity(body: {
    content: ContentObject;
    id?: string;
    force_reindex?: boolean;
  }): Promise<CreateEntityBatchJobAccepted & { id?: string; entity_id?: string }> {
    const payload: Record<string, unknown> = { content: body.content };
    if (body.id) payload.id = body.id;
    if (body.force_reindex !== undefined) payload.force_reindex = body.force_reindex;
    const raw = await this.request<Record<string, unknown>>("POST", "/entity", {
      body: payload,
    });
    if (typeof raw.job_id === "string" && raw.job_id.trim()) {
      return {
        job_id: raw.job_id,
        job_arn: typeof raw.job_arn === "string" ? raw.job_arn : undefined,
        status: typeof raw.status === "string" ? raw.status : "Submitted",
        status_path:
          typeof raw.status_path === "string"
            ? raw.status_path
            : `/v1/entity/batch/jobs/${raw.job_id}`,
        id: typeof raw.id === "string" ? raw.id : undefined,
        entity_id:
          typeof raw.entity_id === "string"
            ? raw.entity_id
            : typeof raw.id === "string"
              ? raw.id
              : undefined,
      };
    }
    const id =
      typeof raw.id === "string"
        ? raw.id
        : typeof raw.entity_id === "string"
          ? raw.entity_id
          : "";
    if (!id) {
      throw new GalyaApiError("createEntity: response missing id or job_id", 200, undefined, raw);
    }
    return {
      job_id: "",
      status: "Completed",
      id,
      entity_id: id,
    };
  }

  async createEntityBatch(body: {
    content: ContentObject[];
    ids?: (string | null)[];
  }): Promise<
    | CreateEntityBatchJobAccepted
    | { results: Array<{ entity_id: string; created: boolean }> }
  > {
    return this.request("POST", "/entity/batch", { body });
  }

  async getEntityBatchJob(jobId: string): Promise<EntityJobPollResult> {
    return this.request<EntityJobPollResult>(
      "GET",
      `/entity/batch/jobs/${encodeURIComponent(jobId)}`,
    );
  }

  async waitForEntityJob(
    jobId: string,
    opts?: { intervalMs?: number; timeoutMs?: number },
  ): Promise<EntityJobPollResult> {
    const intervalMs = Math.max(250, opts?.intervalMs ?? 2000);
    const timeoutMs = Math.max(intervalMs, opts?.timeoutMs ?? 15 * 60_000);
    const started = Date.now();
    for (;;) {
      const body = await this.getEntityBatchJob(jobId);
      const status = String(body.status ?? "");
      if (Array.isArray(body.results) || status === "Completed") return body;
      if (Date.now() - started >= timeoutMs) {
        throw new GalyaApiError(
          `waitForEntityJob timed out after ${timeoutMs}ms (status=${status || "unknown"})`,
          408,
          "job_timeout",
          body,
        );
      }
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  }

  async deleteEntity(entityId: string): Promise<{ success?: boolean }> {
    return this.request("DELETE", "/entity", {
      query: { entity_id: entityId },
    });
  }
}
