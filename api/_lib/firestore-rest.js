// api/_lib/firestore-rest.js — thin REST client for Firestore using FIREBASE_API_KEY.
// Matches the pattern used in pre-generate.js, leaderboard.js, webhook.js.
// Exposes fsGet / fsPatch / fsIncrement (atomic via :commit) / fsQuery + value codecs.

const FB_KEY     = process.env.FIREBASE_API_KEY;
const FB_PROJECT = "molty-portal";
const BASE       = `https://firestore.googleapis.com/v1/projects/${FB_PROJECT}/databases/(default)/documents`;

// ── value codecs ────────────────────────────────────────────────────
// Firestore REST wraps every field in a type-tagged object. These helpers
// keep endpoint code readable.
export function toFS(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === "string")         return { stringValue: v };
  if (typeof v === "boolean")        return { booleanValue: v };
  if (typeof v === "number") {
    return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  }
  if (Array.isArray(v)) {
    return { arrayValue: { values: v.map(toFS) } };
  }
  if (typeof v === "object") {
    return { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k,x]) => [k, toFS(x)])) } };
  }
  return { stringValue: String(v) };
}

export function fromFS(field) {
  if (!field) return null;
  if ("stringValue"    in field) return field.stringValue;
  if ("integerValue"   in field) return parseInt(field.integerValue, 10);
  if ("doubleValue"    in field) return field.doubleValue;
  if ("booleanValue"   in field) return field.booleanValue;
  if ("nullValue"      in field) return null;
  if ("timestampValue" in field) return field.timestampValue;
  if ("arrayValue"     in field) return (field.arrayValue.values || []).map(fromFS);
  if ("mapValue"       in field) {
    const out = {};
    for (const [k, v] of Object.entries(field.mapValue.fields || {})) out[k] = fromFS(v);
    return out;
  }
  return null;
}

export function fieldsToObject(fields) {
  const out = {};
  for (const [k, v] of Object.entries(fields || {})) out[k] = fromFS(v);
  return out;
}

export function objectToFields(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj || {})) out[k] = toFS(v);
  return out;
}

// ── HTTP primitives ─────────────────────────────────────────────────
// Returns null on 404, throws on other non-OK. Returns parsed doc object
// on success ({ name, fields, createTime, updateTime }).
export async function fsGet(col, id) {
  if (!FB_KEY) return null;
  const r = await fetch(`${BASE}/${col}/${encodeURIComponent(id)}?key=${FB_KEY}`, {
    signal: AbortSignal.timeout(5000),
  });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`fsGet ${col}/${id} ${r.status}`);
  return r.json();
}

// Full document replace-or-create (no updateMask).
export async function fsPatch(col, id, fields) {
  if (!FB_KEY) throw new Error("FIREBASE_API_KEY missing");
  const r = await fetch(`${BASE}/${col}/${encodeURIComponent(id)}?key=${FB_KEY}`, {
    method:  "PATCH",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ fields }),
    signal:  AbortSignal.timeout(6000),
  });
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw new Error(`fsPatch ${col}/${id} ${r.status}: ${t.slice(0, 120)}`);
  }
  return r.json();
}

// Merge-write: only the fields listed in updateMask are touched.
export async function fsPatchMerge(col, id, fields, updateMask) {
  if (!FB_KEY) throw new Error("FIREBASE_API_KEY missing");
  const mask = (updateMask || Object.keys(fields)).map(f => `updateMask.fieldPaths=${encodeURIComponent(f)}`).join("&");
  const r = await fetch(`${BASE}/${col}/${encodeURIComponent(id)}?${mask}&key=${FB_KEY}`, {
    method:  "PATCH",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ fields }),
    signal:  AbortSignal.timeout(6000),
  });
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw new Error(`fsPatchMerge ${col}/${id} ${r.status}: ${t.slice(0, 120)}`);
  }
  return r.json();
}

export async function fsDelete(col, id) {
  if (!FB_KEY) return;
  await fetch(`${BASE}/${col}/${encodeURIComponent(id)}?key=${FB_KEY}`, {
    method: "DELETE",
    signal: AbortSignal.timeout(5000),
  });
}

// ── Atomic operations via :commit ──────────────────────────────────
// Increment a single integer field atomically. Creates the doc if missing
// (Firestore transform semantics: applies on top of the current doc, or
// an empty doc if it doesn't exist yet). Returns the new numeric value.
export async function fsIncrement(col, id, field, delta) {
  if (!FB_KEY) throw new Error("FIREBASE_API_KEY missing");
  const docName = `projects/${FB_PROJECT}/databases/(default)/documents/${col}/${id}`;
  const body = {
    writes: [{
      transform: {
        document: docName,
        fieldTransforms: [{
          fieldPath: field,
          increment: { integerValue: String(delta) },
        }],
      },
    }],
  };
  const r = await fetch(`${BASE}:commit?key=${FB_KEY}`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify(body),
    signal:  AbortSignal.timeout(6000),
  });
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw new Error(`fsIncrement ${col}/${id}.${field} ${r.status}: ${t.slice(0, 120)}`);
  }
  const data = await r.json();
  const result = data.writeResults?.[0]?.transformResults?.[0];
  return result ? fromFS(result) : null;
}

// Conditional create: writes iff the doc does not exist. Returns true on
// create, false if it already existed. Used for idempotency dedup keys.
export async function fsCreateIfMissing(col, id, fields) {
  if (!FB_KEY) throw new Error("FIREBASE_API_KEY missing");
  const docName = `projects/${FB_PROJECT}/databases/(default)/documents/${col}/${id}`;
  const body = {
    writes: [{
      update: { name: docName, fields },
      currentDocument: { exists: false },
    }],
  };
  const r = await fetch(`${BASE}:commit?key=${FB_KEY}`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify(body),
    signal:  AbortSignal.timeout(6000),
  });
  if (r.status === 409 || r.status === 400) {
    // FAILED_PRECONDITION = doc exists
    const t = await r.text().catch(() => "");
    if (t.includes("ALREADY_EXISTS") || t.includes("FAILED_PRECONDITION")) return false;
    throw new Error(`fsCreateIfMissing ${col}/${id} ${r.status}: ${t.slice(0, 120)}`);
  }
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    if (t.includes("ALREADY_EXISTS") || t.includes("FAILED_PRECONDITION")) return false;
    throw new Error(`fsCreateIfMissing ${col}/${id} ${r.status}: ${t.slice(0, 120)}`);
  }
  return true;
}

// Structured query. opts: { where?: Array<{path, op, value}>, orderBy?: Array<{path, desc?}>, limit? }
export async function fsQuery(col, opts = {}) {
  if (!FB_KEY) return [];
  const structuredQuery = { from: [{ collectionId: col }] };
  if (opts.where && opts.where.length) {
    if (opts.where.length === 1) {
      const w = opts.where[0];
      structuredQuery.where = {
        fieldFilter: { field: { fieldPath: w.path }, op: w.op, value: toFS(w.value) },
      };
    } else {
      structuredQuery.where = {
        compositeFilter: {
          op: "AND",
          filters: opts.where.map(w => ({
            fieldFilter: { field: { fieldPath: w.path }, op: w.op, value: toFS(w.value) },
          })),
        },
      };
    }
  }
  if (opts.orderBy && opts.orderBy.length) {
    structuredQuery.orderBy = opts.orderBy.map(o => ({
      field: { fieldPath: o.path },
      direction: o.desc ? "DESCENDING" : "ASCENDING",
    }));
  }
  if (opts.limit) structuredQuery.limit = opts.limit;

  const r = await fetch(`${BASE}:runQuery?key=${FB_KEY}`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ structuredQuery }),
    signal:  AbortSignal.timeout(8000),
  });
  if (!r.ok) return [];
  const data = await r.json();
  return data.filter(d => d.document).map(d => ({
    id:     d.document.name.split("/").pop(),
    fields: fieldsToObject(d.document.fields),
    raw:    d.document,
  }));
}

// ── Convenience: read a doc and return its fields as a plain object ──
export async function fsGetFields(col, id) {
  const doc = await fsGet(col, id);
  if (!doc) return null;
  return fieldsToObject(doc.fields);
}
