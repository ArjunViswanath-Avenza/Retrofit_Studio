// Local decompile service for the Java JAR comparison (Fabric workspace).
// Runs inside the Vite dev server (npm run dev): the browser posts a jar, this decompiles it with Vineflower on the
// machine's Java and returns every file of the result as text. Results are cached by the jar's SHA-256, so each
// jar is decompiled once. Without Java (or outside the dev server) the app falls back to its in-browser bytecode view.
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");
const VINEFLOWER = path.join(ROOT, "tools", "vineflower-1.11.1.jar");
const CACHE = path.join(ROOT, "node_modules", ".cache", "retrofit-decompile");
const JAVA = process.env.RETROFIT_JAVA || "java";
const TEXT = /\.(java|xml|properties|json|txt|html?|css|js|sql|MF|yml|yaml|xsd|wsdl|vm|ftl|csv)$/i;

const run = (cmd, args) => new Promise((resolve, reject) =>
  execFile(cmd, args, { maxBuffer: 64 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => (err ? reject(new Error(stderr || err.message)) : resolve({ stdout, stderr }))));

let status = null;
async function getStatus() {
  if (status) return status;
  const s = { available: false, decompiler: "Vineflower 1.11.1", java: null, reason: "" };
  if (!fs.existsSync(VINEFLOWER)) s.reason = `decompiler not found at ${VINEFLOWER}`;
  else {
    try {
      const { stderr, stdout } = await run(JAVA, ["-version"]);
      s.java = ((stderr || stdout).split(/\r?\n/)[0] || "").trim();
      s.available = true;
    } catch (e) { s.reason = `Java not found (${e.message.split(/\r?\n/)[0]})`; }
  }
  return (status = s);
}

function walk(dir, base = dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, base, out); else out.push(path.relative(base, p).split(path.sep).join("/"));
  }
  return out;
}

let queue = Promise.resolve(); // one java process at a time
function decompile(buf, name) {
  const sha = createHash("sha256").update(buf).digest("hex");
  const cached = path.join(CACHE, `${sha}.json`);
  if (fs.existsSync(cached)) return Promise.resolve(fs.readFileSync(cached, "utf8"));
  const job = queue.then(async () => {
    if (fs.existsSync(cached)) return fs.readFileSync(cached, "utf8");
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "rs-decompile-"));
    try {
      const jar = path.join(tmp, "in.jar"), out = path.join(tmp, "out");
      fs.writeFileSync(jar, buf);
      const t0 = Date.now();
      await run(JAVA, ["-jar", VINEFLOWER, "--silent", "--folder", jar, out]);
      const files = {}, binaries = {};
      for (const rel of fs.existsSync(out) ? walk(out) : []) {
        const p = path.join(out, rel);
        if (TEXT.test(rel)) files[rel] = fs.readFileSync(p, "utf8");
        else { const b = fs.readFileSync(p); binaries[rel] = { size: b.length, sha: createHash("sha256").update(b).digest("hex").slice(0, 16) }; }
      }
      const json = JSON.stringify({ name, sha, decompiler: "Vineflower 1.11.1", ms: Date.now() - t0, files, binaries });
      fs.mkdirSync(CACHE, { recursive: true });
      fs.writeFileSync(cached, json);
      return json;
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
  queue = job.catch(() => {});
  return job;
}

export function decompilerPlugin() {
  return {
    name: "retrofit-decompiler",
    configureServer(server) {
      server.middlewares.use("/api/decompiler/status", async (req, res) => {
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify(await getStatus()));
      });
      server.middlewares.use("/api/decompile", (req, res) => {
        if (req.method !== "POST") { res.statusCode = 405; res.end(); return; }
        const chunks = [];
        req.on("data", (c) => chunks.push(c));
        req.on("end", async () => {
          try {
            const s = await getStatus();
            if (!s.available) throw new Error(s.reason || "decompiler unavailable");
            const name = decodeURIComponent(req.headers["x-jar-name"] || "jar");
            const json = await decompile(Buffer.concat(chunks), name);
            res.setHeader("Content-Type", "application/json");
            res.end(json);
          } catch (e) {
            res.statusCode = 500;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ error: String(e.message || e).slice(0, 2000) }));
          }
        });
      });
    },
  };
}
