import type { CollectionRules, CollectionSyncConfig } from "./types";

function shallowMatch(
  doc: Record<string, unknown>,
  conditions: Record<string, unknown>,
): boolean {
  for (const [key, expected] of Object.entries(conditions)) {
    const actual = getPath(doc, key);
    if (!valuesEqual(actual, expected)) return false;
  }
  return true;
}

function valuesEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (a === null || b === null || a === undefined || b === undefined) {
    return a === b;
  }
  return a === b;
}

/** Read `a.b.c` from a plain object. */
export function getPath(obj: Record<string, unknown>, dotted: string): unknown {
  const parts = dotted.split(".");
  let cur: unknown = obj;
  for (const p of parts) {
    if (cur === null || cur === undefined || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

/**
 * Returns true if the document should be synced to Galya.
 */
export function shouldInclude(
  doc: Record<string, unknown> | undefined | null,
  rules?: CollectionRules,
): boolean {
  if (!doc) return false;
  if (!rules) return true;
  if (rules.includeWhen && !shallowMatch(doc, rules.includeWhen)) return false;
  if (rules.excludeWhen && shallowMatch(doc, rules.excludeWhen)) return false;
  return true;
}

/**
 * Pick configured fields (or all top-level) and detect whether listed fields changed.
 */
export function pickFields(
  data: Record<string, unknown>,
  fields?: string[],
): Record<string, unknown> {
  if (!fields || fields.length === 0) {
    return { ...data };
  }
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    const v = getPath(data, f);
    if (v !== undefined) {
      if (f.includes(".")) {
        setPath(out, f, v);
      } else {
        out[f] = v;
      }
    }
  }
  return out;
}

function setPath(obj: Record<string, unknown>, dotted: string, value: unknown): void {
  const parts = dotted.split(".");
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i]!;
    if (typeof cur[p] !== "object" || cur[p] === null) {
      cur[p] = {};
    }
    cur = cur[p] as Record<string, unknown>;
  }
  cur[parts[parts.length - 1]!] = value;
}

export function fieldsChanged(
  before: Record<string, unknown> | undefined,
  after: Record<string, unknown> | undefined,
  fields?: string[],
): boolean {
  if (!before && after) return true;
  if (before && !after) return true;
  if (!before || !after) return false;
  const keys = fields && fields.length > 0 ? fields : Object.keys({ ...before, ...after });
  for (const k of keys) {
    if (!valuesEqual(getPath(before, k), getPath(after, k))) return true;
  }
  // Also consider rule fields so status flips re-evaluate.
  return false;
}

export function ruleFieldsChanged(
  before: Record<string, unknown> | undefined,
  after: Record<string, unknown> | undefined,
  cfg: CollectionSyncConfig,
): boolean {
  const ruleKeys = [
    ...Object.keys(cfg.rules?.includeWhen ?? {}),
    ...Object.keys(cfg.rules?.excludeWhen ?? {}),
  ];
  if (ruleKeys.length === 0) return false;
  return fieldsChanged(before, after, ruleKeys);
}

/**
 * Simple mustache-style replace: `{{field}}` and `{{a.b}}`.
 * Missing values become empty string.
 */
export function renderTemplate(
  template: string,
  ctx: Record<string, unknown>,
): string {
  return template.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_m, key: string) => {
    const v = getPath(ctx, key.trim());
    if (v === null || v === undefined) return "";
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
      return String(v);
    }
    if (typeof v === "object" && v !== null && "toDate" in v && typeof (v as { toDate: () => Date }).toDate === "function") {
      return (v as { toDate: () => Date }).toDate().toISOString();
    }
    try {
      return JSON.stringify(v);
    } catch {
      return "";
    }
  });
}
