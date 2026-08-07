import {
  getFirestore,
  type QueryDocumentSnapshot,
} from "firebase-admin/firestore";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { loadSyncConfig } from "./config";
import { firestoreDocToPlain, mapFirestoreDoc } from "./map";
import { applyGalyaEnvFromParams, secretBindings } from "./params";
import { shouldInclude } from "./rules";
import { resetGalyaClient, upsertContentBatch } from "./sync";
import type { CollectionSyncConfig, GalyaSyncDefaults, MappedContent } from "./types";

type BackfillRequest = {
  paths?: string[];
  limitPerCollection?: number;
  batchSize?: number;
};

type BackfillResult = {
  collections: Array<{
    path: string;
    scanned: number;
    upserted: number;
    skipped: number;
    errors: number;
    jobIds: string[];
  }>;
};

function collectionRefForPath(pathPattern: string) {
  const parts = pathPattern.replace(/^\/+|\/+$/g, "").split("/");
  const hasWildcard = parts.some((p) => p.startsWith("{") && p.endsWith("}"));
  if (!hasWildcard) {
    return { kind: "collection" as const, ref: getFirestore().collection(pathPattern) };
  }
  const last = parts[parts.length - 1]!;
  if (last.startsWith("{")) {
    throw new Error(
      `galya-firebase: invalid collection path "${pathPattern}" — last segment must be a collection id`,
    );
  }
  return { kind: "group" as const, ref: getFirestore().collectionGroup(last) };
}

async function backfillCollection(
  cfg: CollectionSyncConfig,
  defaults: GalyaSyncDefaults | undefined,
  batchSize: number,
  limitPerCollection?: number,
): Promise<BackfillResult["collections"][number]> {
  const { ref } = collectionRefForPath(cfg.path);
  let scanned = 0;
  let upserted = 0;
  let skipped = 0;
  let errors = 0;
  const jobIds: string[] = [];

  let lastDoc: QueryDocumentSnapshot | undefined;

  for (;;) {
    if (limitPerCollection !== undefined && scanned >= limitPerCollection) break;

    let page = ref.limit(batchSize);
    if (lastDoc) {
      page = ref.startAfter(lastDoc).limit(batchSize);
    }

    const snap = await page.get();
    if (snap.empty) break;

    const items: Array<{ sourceKey: string; mapped: MappedContent }> = [];

    for (const doc of snap.docs) {
      if (limitPerCollection !== undefined && scanned >= limitPerCollection) break;
      scanned += 1;
      lastDoc = doc;

      if (!pathMatchesPattern(doc.ref.path, cfg.path)) {
        skipped += 1;
        continue;
      }

      const data = firestoreDocToPlain(doc.data() as Record<string, unknown>);
      if (!shouldInclude(data, cfg.rules)) {
        skipped += 1;
        continue;
      }

      try {
        const mapped = mapFirestoreDoc({
          cfg,
          defaults,
          docId: doc.id,
          docPath: doc.ref.path,
          data,
        });
        items.push({ sourceKey: doc.ref.path, mapped });
      } catch (err) {
        console.error("galya-firebase: map failed", doc.ref.path, err);
        errors += 1;
      }
    }

    if (items.length > 0) {
      try {
        const { jobId, results } = await upsertContentBatch({
          source: "firestore",
          items,
          waitForJob: true,
        });
        if (jobId) jobIds.push(jobId);
        upserted += results.length;
      } catch (err) {
        console.error("galya-firebase: batch upsert failed", cfg.path, err);
        errors += items.length;
      }
    }

    if (snap.size < batchSize) break;
  }

  return { path: cfg.path, scanned, upserted, skipped, errors, jobIds };
}

export function pathMatchesPattern(docPath: string, pattern: string): boolean {
  const docParts = docPath.split("/");
  const patParts = pattern.replace(/^\/+|\/+$/g, "").split("/");
  const expected: string[] = [];
  for (const p of patParts) {
    expected.push(p);
    expected.push("{doc}");
  }
  if (docParts.length !== expected.length) return false;
  for (let i = 0; i < expected.length; i++) {
    const e = expected[i]!;
    const d = docParts[i]!;
    if (e === "{doc}" || (e.startsWith("{") && e.endsWith("}"))) continue;
    if (e !== d) return false;
  }
  return true;
}

export async function runBackfill(req: BackfillRequest = {}): Promise<BackfillResult> {
  const config = loadSyncConfig();
  const batchSize = Math.min(
    200,
    Math.max(1, req.batchSize ?? config.defaults?.batchSize ?? 50),
  );

  let collections = config.collections;
  if (req.paths?.length) {
    const set = new Set(req.paths);
    collections = collections.filter((c) => set.has(c.path));
  }

  const results: BackfillResult["collections"] = [];
  for (const col of collections) {
    results.push(
      await backfillCollection(col, config.defaults, batchSize, req.limitPerCollection),
    );
  }
  return { collections: results };
}

export const galyaBackfill = onCall(
  {
    timeoutSeconds: 540,
    memory: "1GiB",
    secrets: secretBindings(),
  },
  async (request) => {
    applyGalyaEnvFromParams();
    resetGalyaClient();
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Sign in required to run galyaBackfill");
    }
    const body = (request.data ?? {}) as BackfillRequest;
    try {
      return await runBackfill(body);
    } catch (err) {
      console.error("galya-firebase: backfill failed", err);
      throw new HttpsError(
        "internal",
        err instanceof Error ? err.message : "backfill failed",
      );
    }
  },
);
