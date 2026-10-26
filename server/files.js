// Local file service (dev server only): the app opens project folders by their path on this machine instead of the
// browser's folder picker. A folder is listed once; files are read in batches and kept in memory (as bytes, outside the
// JavaScript heap) up to a budget, so every later read of the same file — the next comparison, the next tool — is
// instant. A watcher drops changed files from memory. Nothing leaves this machine: requests are answered only when
// they come to localhost, and only for files inside a folder opened in this session.
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { isLocal, refuse } from "./local.js";

const BUDGET = (Number(process.env.RETROFIT_CACHE_MB) || 1500) * 1e6; // bytes of file contents kept in memory
const WARM = /\.(json|js|xml|css)$/i; // read ahead after a folder opens
const MAX_WARM_FILE = 2e6;

const roots = new Map(); // id -> { id, dir, name, skip, files: [rel], changed: 0, watcher, warming }
const cache = new Map(); // absolute path -> Buffer (Map order = least recently used first)
let cached = 0;
let clientReads = 0; // in-flight batch requests; warming waits while there are any

const remember = (abs, buf) => {
  if (cache.has(abs)) { cached -= cache.get(abs).length; cache.delete(abs); }
  if (buf.length > BUDGET / 4) return;
  cache.set(abs, buf);
  cached += buf.length;
  for (const [k, v] of cache) { if (cached <= BUDGET) break; cache.delete(k); cached -= v.length; }
};
const forget = (abs) => { const b = cache.get(abs); if (b) { cached -= b.length; cache.delete(abs); } };

async function readFile(abs) {
  const hit = cache.get(abs);
  if (hit) { cache.delete(abs); cache.set(abs, hit); return hit; }
  const buf = await fsp.readFile(abs);
  remember(abs, buf);
  return buf;
}

// parallel walk: one readdir per folder, many at once (a plain recursive walk is ~20× slower on Windows)
async function walk(dir, skip, conc = 48) {
  const out = [];
  const queue = [""];
  let active = 0;
  await new Promise((done) => {
    const pump = () => {
      if (!queue.length && !active) { done(); return; }
      while (queue.length && active < conc) {
        const rel = queue.pop();
        active++;
        fsp.readdir(path.join(dir, rel), { withFileTypes: true })
          .then((ents) => {
            for (const e of ents) {
              const r = rel ? `${rel}/${e.name}` : e.name;
              if (e.isDirectory()) { if (!skip.has(e.name)) queue.push(r); } else if (e.isFile()) out.push(r);
            }
          })
          .catch(() => { /* unreadable folder: skipped */ })
          .finally(() => { active--; pump(); });
      }
    };
    pump();
  });
  return out.sort();
}

// read the text files of an opened folder ahead of time, a few at a time, giving way to the app's own reads
async function warm(R) {
  R.warming = { done: 0, total: 0 };
  const list = R.files.filter((r) => WARM.test(r));
  R.warming.total = list.length;
  for (let i = 0; i < list.length; i += 16) {
    if (!roots.has(R.id) || cached > BUDGET * 0.9) break;
    while (clientReads) await new Promise((r) => setTimeout(r, 30));
    await Promise.all(list.slice(i, i + 16).map(async (rel) => {
      const abs = path.join(R.dir, rel);
      if (cache.has(abs)) return;
      try { const st = await fsp.stat(abs); if (st.size <= MAX_WARM_FILE) remember(abs, await fsp.readFile(abs)); } catch { /* gone */ }
    }));
    R.warming.done = Math.min(list.length, i + 16);
  }
  R.warming.finished = true;
}

function open(dir, skipList) {
  const abs = path.resolve(dir);
  const id = createHash("sha1").update(abs.toLowerCase() + "|" + skipList.join(",")).digest("hex").slice(0, 16);
  const old = roots.get(id);
  if (old && old.watcher) old.watcher.close();
  const R = { id, dir: abs, name: path.basename(abs), skip: new Set(skipList), files: [], changed: 0, watcher: null, warming: null };
  roots.set(id, R);
  return R;
}

const json = (res, code, body) => { res.statusCode = code; res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(body)); };
const body = (req) => new Promise((resolve, reject) => { const c = []; req.on("data", (x) => c.push(x)); req.on("end", () => { try { resolve(JSON.parse(Buffer.concat(c).toString("utf8") || "{}")); } catch (e) { reject(e); } }); req.on("error", reject); });
const inside = (R, rel) => {
  const segs = String(rel || "").split(/[\\/]/).filter(Boolean);
  if (!segs.length || segs.some((s) => s === ".." || s === ".")) return null;
  const abs = path.resolve(R.dir, ...segs);
  return abs.startsWith(R.dir + path.sep) ? abs : null;
};
const TYPES = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", svg: "image/svg+xml", webp: "image/webp", ttf: "font/ttf", json: "application/json", js: "text/javascript", css: "text/css", xml: "application/xml" };

export function filesPlugin() {
  return {
    name: "retrofit-files",
    configureServer(server) {
      server.middlewares.use("/api/fs", async (req, res) => {
        if (!isLocal(req)) return refuse(res, "file service");
        const url = new URL(req.url, "http://localhost");
        try {
          // GET /api/fs/status — is the service here, and what is open
          if (url.pathname === "/status") {
            return json(res, 200, {
              available: true, budgetMb: Math.round(BUDGET / 1e6), cachedMb: Math.round(cached / 1e6), cachedFiles: cache.size,
              roots: [...roots.values()].map((R) => ({ id: R.id, dir: R.dir, files: R.files.length, changed: R.changed, warming: R.warming })),
            });
          }
          // POST /api/fs/open { path, skip: [folder names] } — list a folder
          if (url.pathname === "/open" && req.method === "POST") {
            const { path: dir, skip = [] } = await body(req);
            if (!dir || !path.isAbsolute(dir)) return json(res, 400, { error: "give the folder's full path, e.g. C:\\Projects\\KBZ\\konyonlinebanking2021" });
            let st;
            try { st = fs.statSync(dir); } catch { return json(res, 404, { error: `folder not found: ${dir}` }); }
            if (!st.isDirectory()) return json(res, 400, { error: `not a folder: ${dir}` });
            const R = open(dir, skip);
            const t0 = Date.now();
            R.files = await walk(R.dir, R.skip);
            // sizes only where a tool shows them (jars, archives): a stat of every file would cost more than the listing
            const sizes = {};
            await Promise.all(R.files.filter((r) => /\.(jar|zip)$/i.test(r)).map(async (r) => { try { sizes[r] = (await fsp.stat(path.join(R.dir, r))).size; } catch { /* gone */ } }));
            try {
              R.watcher = fs.watch(R.dir, { recursive: true }, (ev, f) => {
                if (!f) return;
                R.changed++;
                forget(path.join(R.dir, f));
              });
              R.watcher.on("error", () => { /* watching is best effort */ });
            } catch { /* no recursive watch here: changes are picked up by opening the folder again */ }
            warm(R);
            return json(res, 200, { id: R.id, dir: R.dir, name: R.name, files: R.files, sizes, ms: Date.now() - t0 });
          }
          // POST /api/fs/read { id, paths } — many files in one answer: per file a 4-byte length (-1 = unreadable), then the bytes
          if (url.pathname === "/read" && req.method === "POST") {
            const { id, paths = [] } = await body(req);
            const R = roots.get(id);
            if (!R) return json(res, 410, { error: "folder no longer open — open it again" });
            clientReads++;
            try {
              const bufs = new Array(paths.length);
              for (let i = 0; i < paths.length; i += 64) {
                await Promise.all(paths.slice(i, i + 64).map(async (rel, k) => {
                  const abs = inside(R, rel);
                  try { bufs[i + k] = abs ? await readFile(abs) : null; } catch { bufs[i + k] = null; }
                }));
              }
              const parts = [];
              for (const b of bufs) {
                const len = Buffer.alloc(4);
                len.writeInt32LE(b ? b.length : -1);
                parts.push(len);
                if (b) parts.push(b);
              }
              res.setHeader("Content-Type", "application/octet-stream");
              res.end(Buffer.concat(parts));
            } finally { clientReads--; }
            return;
          }
          // GET /api/fs/raw?id=&p= — one file as itself (images in previews, jars)
          if (url.pathname === "/raw") {
            const R = roots.get(url.searchParams.get("id"));
            const abs = R && inside(R, url.searchParams.get("p"));
            if (!abs) return json(res, 404, { error: "not found" });
            const buf = await readFile(abs);
            res.setHeader("Content-Type", TYPES[path.extname(abs).slice(1).toLowerCase()] || "application/octet-stream");
            res.end(buf);
            return;
          }
          json(res, 404, { error: "unknown request" });
        } catch (e) {
          json(res, 500, { error: String((e && e.message) || e) });
        }
      });
    },
  };
}
