var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// .wrangler/tmp/bundle-iM4B6T/checked-fetch.js
var urls = /* @__PURE__ */ new Set();
function checkURL(request, init) {
  const url = request instanceof URL ? request : new URL(
    (typeof request === "string" ? new Request(request, init) : request).url
  );
  if (url.port && url.port !== "443" && url.protocol === "https:") {
    if (!urls.has(url.toString())) {
      urls.add(url.toString());
      console.warn(
        `WARNING: known issue with \`fetch()\` requests to custom HTTPS ports in published Workers:
 - ${url.toString()} - the custom port will be ignored when the Worker is published using the \`wrangler deploy\` command.
`
      );
    }
  }
}
__name(checkURL, "checkURL");
globalThis.fetch = new Proxy(globalThis.fetch, {
  apply(target, thisArg, argArray) {
    const [request, init] = argArray;
    checkURL(request, init);
    return Reflect.apply(target, thisArg, argArray);
  }
});

// src/index.ts
function rowToPage(row) {
  return {
    id: row.id,
    area: row.area,
    title: row.title,
    slug: row.slug,
    sortOrder: row.sort_order,
    content: JSON.parse(row.content),
    sourceFile: row.source_file,
    baseContentHash: row.base_content_hash,
    status: row.status,
    metadata: JSON.parse(row.metadata),
    parentId: row.parent_id,
    depth: row.depth,
    pageType: row.page_type,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
__name(rowToPage, "rowToPage");
function rowToListItem(row) {
  return {
    id: row.id,
    area: row.area,
    title: row.title,
    slug: row.slug,
    sortOrder: row.sort_order,
    status: row.status,
    sourceFile: row.source_file,
    parentId: row.parent_id,
    depth: row.depth,
    pageType: row.page_type,
    updatedAt: row.updated_at
  };
}
__name(rowToListItem, "rowToListItem");
function buildTree(items) {
  const map = /* @__PURE__ */ new Map();
  const roots = [];
  for (const item of items) {
    map.set(item.id, {
      id: item.id,
      title: item.title,
      slug: item.slug,
      sortOrder: item.sortOrder,
      pageType: item.pageType,
      depth: item.depth,
      status: item.status,
      metadata: item.metadata || {},
      children: []
    });
  }
  for (const item of items) {
    const node = map.get(item.id);
    if (item.parentId && map.has(item.parentId)) {
      map.get(item.parentId).children.push(node);
    } else {
      roots.push(node);
    }
  }
  const sortNodes = /* @__PURE__ */ __name((nodes) => {
    nodes.sort((a, b) => a.sortOrder - b.sortOrder);
    nodes.forEach((n) => sortNodes(n.children));
  }, "sortNodes");
  sortNodes(roots);
  return roots;
}
__name(buildTree, "buildTree");
function jsonResponse(data, status = 200, corsHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" }
  });
}
__name(jsonResponse, "jsonResponse");
function getCorsHeaders(request, env) {
  const allowedOrigins = env.ALLOWED_ORIGINS?.split(",") || [];
  const origin = request.headers.get("Origin") || "";
  const headers = {};
  const isAllowed = allowedOrigins.some((allowed) => {
    allowed = allowed.trim();
    if (allowed === origin) return true;
    if (allowed.includes("*.")) {
      const domain = allowed.split("*.")[1];
      return origin.endsWith(domain);
    }
    return false;
  });
  if (isAllowed) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, DELETE, OPTIONS";
    headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization";
  }
  return headers;
}
__name(getCorsHeaders, "getCorsHeaders");
function isAuthorized(request, env) {
  if (!env.API_TOKEN) return true;
  const auth = request.headers.get("Authorization");
  if (!auth) return false;
  const token = auth.replace("Bearer ", "");
  return token === env.API_TOKEN;
}
__name(isAuthorized, "isAuthorized");
async function listPages(area, db, cors) {
  const result = await db.prepare("SELECT * FROM pages WHERE area = ? ORDER BY sort_order ASC").bind(area).all();
  const items = (result.results || []).map(rowToListItem);
  return jsonResponse({ ok: true, data: items }, 200, cors);
}
__name(listPages, "listPages");
async function getPage(area, slug, db, cors) {
  const id = `${area}/${slug}`;
  const row = await db.prepare("SELECT * FROM pages WHERE id = ?").bind(id).first();
  if (!row) {
    return jsonResponse({ ok: false, error: "Page not found" }, 404, cors);
  }
  return jsonResponse({ ok: true, data: rowToPage(row) }, 200, cors);
}
__name(getPage, "getPage");
async function upsertPage(area, slug, body, db, cors) {
  const id = `${area}/${slug}`;
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const existing = await db.prepare("SELECT id, source_file, status FROM pages WHERE id = ?").bind(id).first();
  if (existing) {
    const updates = [];
    const values = [];
    if (body.title !== void 0) {
      updates.push("title = ?");
      values.push(body.title);
    }
    if (body.content !== void 0) {
      updates.push("content = ?");
      values.push(JSON.stringify(body.content));
    }
    if (body.sortOrder !== void 0) {
      updates.push("sort_order = ?");
      values.push(body.sortOrder);
    }
    if (body.metadata !== void 0) {
      updates.push("metadata = ?");
      values.push(JSON.stringify(body.metadata));
    }
    if (body.parentId !== void 0) {
      updates.push("parent_id = ?");
      values.push(body.parentId);
    }
    if (body.depth !== void 0) {
      updates.push("depth = ?");
      values.push(body.depth);
    }
    if (body.pageType !== void 0) {
      updates.push("page_type = ?");
      values.push(body.pageType);
    }
    if (body.content !== void 0 && existing.source_file) {
      updates.push("status = 'modified'");
    }
    updates.push("updated_at = ?");
    values.push(now);
    values.push(id);
    await db.prepare(`UPDATE pages SET ${updates.join(", ")} WHERE id = ?`).bind(...values).run();
  } else {
    await db.prepare(
      `INSERT INTO pages (id, area, title, slug, sort_order, content, status, metadata, parent_id, depth, page_type, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'local_only', ?, ?, ?, ?, ?, ?)`
    ).bind(
      id,
      area,
      body.title || "",
      slug,
      body.sortOrder || 0,
      JSON.stringify(body.content || []),
      JSON.stringify(body.metadata || {}),
      body.parentId || null,
      body.depth || 0,
      body.pageType || "page",
      now,
      now
    ).run();
  }
  const updated = await db.prepare("SELECT * FROM pages WHERE id = ?").bind(id).first();
  return jsonResponse({ ok: true, data: updated ? rowToPage(updated) : null }, existing ? 200 : 201, cors);
}
__name(upsertPage, "upsertPage");
async function deletePage(area, slug, db, cors) {
  const id = `${area}/${slug}`;
  const result = await db.prepare("DELETE FROM pages WHERE id = ?").bind(id).run();
  if (result.meta.changes === 0) {
    return jsonResponse({ ok: false, error: "Page not found" }, 404, cors);
  }
  return jsonResponse({ ok: true }, 200, cors);
}
__name(deletePage, "deletePage");
async function importPages(body, db, cors) {
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const imported = [];
  const skipped = [];
  const updated = [];
  for (const page of body.pages) {
    const existing = await db.prepare("SELECT id, status, base_content_hash FROM pages WHERE id = ?").bind(page.id).first();
    if (!existing) {
      await db.prepare(
        `INSERT INTO pages (id, area, title, slug, sort_order, content, source_file, base_content_hash, status, metadata, parent_id, depth, page_type, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'synced', ?, ?, ?, ?, ?, ?)`
      ).bind(
        page.id,
        page.area,
        page.title,
        page.slug,
        page.sortOrder || 0,
        JSON.stringify(page.content),
        page.sourceFile,
        page.contentHash,
        JSON.stringify(page.metadata || {}),
        page.parentId || null,
        page.depth || 0,
        page.pageType || "page",
        now,
        now
      ).run();
      imported.push(page.id);
    } else if (existing.status === "synced") {
      if (existing.base_content_hash !== page.contentHash) {
        await db.prepare(
          `UPDATE pages SET title = ?, content = ?, base_content_hash = ?, source_file = ?, updated_at = ? WHERE id = ?`
        ).bind(page.title, JSON.stringify(page.content), page.contentHash, page.sourceFile, now, page.id).run();
        updated.push(page.id);
      } else {
        skipped.push(page.id);
      }
    } else {
      if (existing.base_content_hash !== page.contentHash) {
        await db.prepare(
          `UPDATE pages SET metadata = json_set(COALESCE(metadata, '{}'), '$.pendingSourceHash', ?), updated_at = ? WHERE id = ?`
        ).bind(page.contentHash, now, page.id).run();
        skipped.push(page.id);
      } else {
        skipped.push(page.id);
      }
    }
  }
  await db.prepare(
    `INSERT INTO sync_log (action, affected_pages, source_commit, details, created_at)
       VALUES ('import', ?, ?, ?, ?)`
  ).bind(
    JSON.stringify([...imported, ...updated]),
    body.sourceCommit || null,
    JSON.stringify({ imported: imported.length, updated: updated.length, skipped: skipped.length }),
    now
  ).run();
  return jsonResponse(
    {
      ok: true,
      data: {
        imported: imported.length,
        updated: updated.length,
        skipped: skipped.length,
        details: { imported, updated, skipped }
      }
    },
    200,
    cors
  );
}
__name(importPages, "importPages");
async function getSyncStatus(db, cors) {
  const counts = await db.prepare(
    `SELECT
        area,
        status,
        COUNT(*) as count
       FROM pages
       GROUP BY area, status
       ORDER BY area`
  ).all();
  const pendingUpdates = await db.prepare(
    `SELECT id, area, title FROM pages
       WHERE json_extract(metadata, '$.pendingSourceHash') IS NOT NULL`
  ).all();
  const lastSync = await db.prepare("SELECT * FROM sync_log ORDER BY created_at DESC LIMIT 1").first();
  return jsonResponse(
    {
      ok: true,
      data: {
        pageCounts: counts.results || [],
        pendingUpdates: pendingUpdates.results || [],
        lastSync
      }
    },
    200,
    cors
  );
}
__name(getSyncStatus, "getSyncStatus");
var src_default = {
  async fetch(request, env) {
    const url = new URL(request.url);
    const cors = getCorsHeaders(request, env);
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: cors });
    }
    const path = url.pathname;
    const isWriteMethod = ["POST", "PUT", "DELETE"].includes(request.method);
    if (isWriteMethod && !isAuthorized(request, env)) {
      return jsonResponse({ ok: false, error: "Unauthorized" }, 401, cors);
    }
    if (path === "/api/content/sync/import" && request.method === "POST") {
      const body = await request.json();
      return importPages(body, env.CONTENT_DB, cors);
    }
    if (path === "/api/content/sync/status" && request.method === "GET") {
      return getSyncStatus(env.CONTENT_DB, cors);
    }
    const treeMatch = path.match(/^\/api\/content\/([a-z]+)\/tree$/);
    if (treeMatch && request.method === "GET") {
      const area = treeMatch[1];
      const result = await env.CONTENT_DB.prepare("SELECT * FROM pages WHERE area = ? ORDER BY sort_order ASC").bind(area).all();
      const rows = result.results || [];
      const items = rows.map((r) => ({
        ...rowToListItem(r),
        metadata: JSON.parse(r.metadata || "{}")
      }));
      const tree = buildTree(items);
      return jsonResponse({ ok: true, data: tree }, 200, cors);
    }
    const contentMatch = path.match(/^\/api\/content\/([a-z]+)(?:\/(.+))?$/);
    if (contentMatch) {
      const [, area, slug] = contentMatch;
      if (!slug) {
        if (request.method === "GET") return listPages(area, env.CONTENT_DB, cors);
        return jsonResponse({ ok: false, error: "Method not allowed" }, 405, cors);
      }
      switch (request.method) {
        case "GET":
          return getPage(area, slug, env.CONTENT_DB, cors);
        case "PUT": {
          const body = await request.json();
          return upsertPage(area, slug, body, env.CONTENT_DB, cors);
        }
        case "DELETE":
          return deletePage(area, slug, env.CONTENT_DB, cors);
        default:
          return jsonResponse({ ok: false, error: "Method not allowed" }, 405, cors);
      }
    }
    if (path === "/api/health") {
      return jsonResponse({ ok: true, data: { service: "content-api", version: "1.0.0" } }, 200, cors);
    }
    return jsonResponse({ ok: false, error: "Not found" }, 404, cors);
  }
};

// ../../node_modules/.pnpm/wrangler@4.88.0_@cloudflare+workers-types@4.20260111.0/node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
var drainBody = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default = drainBody;

// ../../node_modules/.pnpm/wrangler@4.88.0_@cloudflare+workers-types@4.20260111.0/node_modules/wrangler/templates/middleware/middleware-miniflare3-json-error.ts
function reduceError(e) {
  return {
    name: e?.name,
    message: e?.message ?? String(e),
    stack: e?.stack,
    cause: e?.cause === void 0 ? void 0 : reduceError(e.cause)
  };
}
__name(reduceError, "reduceError");
var jsonError = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } catch (e) {
    const error = reduceError(e);
    return Response.json(error, {
      status: 500,
      headers: { "MF-Experimental-Error-Stack": "true" }
    });
  }
}, "jsonError");
var middleware_miniflare3_json_error_default = jsonError;

// .wrangler/tmp/bundle-iM4B6T/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default,
  middleware_miniflare3_json_error_default
];
var middleware_insertion_facade_default = src_default;

// ../../node_modules/.pnpm/wrangler@4.88.0_@cloudflare+workers-types@4.20260111.0/node_modules/wrangler/templates/middleware/common.ts
var __facade_middleware__ = [];
function __facade_register__(...args) {
  __facade_middleware__.push(...args.flat());
}
__name(__facade_register__, "__facade_register__");
function __facade_invokeChain__(request, env, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env, ctx, middlewareCtx);
}
__name(__facade_invokeChain__, "__facade_invokeChain__");
function __facade_invoke__(request, env, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__(request, env, ctx, dispatch, [
    ...__facade_middleware__,
    finalMiddleware
  ]);
}
__name(__facade_invoke__, "__facade_invoke__");

// .wrangler/tmp/bundle-iM4B6T/middleware-loader.entry.ts
var __Facade_ScheduledController__ = class ___Facade_ScheduledController__ {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  static {
    __name(this, "__Facade_ScheduledController__");
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof ___Facade_ScheduledController__)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
function wrapExportedHandler(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name(function(request, env, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env, ctx) {
      const dispatcher = /* @__PURE__ */ __name(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__(request, env, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler, "wrapExportedHandler");
function wrapWorkerEntrypoint(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  return class extends klass {
    #fetchDispatcher = /* @__PURE__ */ __name((request, env, ctx) => {
      this.env = env;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    }, "#fetchDispatcher");
    #dispatcher = /* @__PURE__ */ __name((type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    }, "#dispatcher");
    fetch(request) {
      return __facade_invoke__(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY;
if (typeof middleware_insertion_facade_default === "object") {
  WRAPPED_ENTRY = wrapExportedHandler(middleware_insertion_facade_default);
} else if (typeof middleware_insertion_facade_default === "function") {
  WRAPPED_ENTRY = wrapWorkerEntrypoint(middleware_insertion_facade_default);
}
var middleware_loader_entry_default = WRAPPED_ENTRY;
export {
  __INTERNAL_WRANGLER_MIDDLEWARE__,
  middleware_loader_entry_default as default
};
//# sourceMappingURL=index.js.map
