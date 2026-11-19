// Output writer (dev server only): "Move to R26" (TemplateTwin, COMP-are, FormForge) writes merged segment templates /
// user widgets / forms into a separate output folder laid out like the R26 project (<root>/<MA>/templates/<ch>/segments/
// <name>.sm/, <root>/<MA>/userwidgets/<component>/userwidgetmodel.sm/, <root>/<MA>/forms/<ch>/<module>/<form>.sm/,
// CtrlSync: <root>/<MA>/controllers/<ch>/…/<name>Controller.js). It never writes into a
// Visualizer project: any folder on the way that holds projectProperties.json (R21, KBZ, R26 or any micro app) is
// refused. Answers only on localhost (server/local.js).
import fs from "node:fs";
import path from "node:path";
import { isLocal, refuse } from "./local.js";

const json = (res, code, body) => { res.statusCode = code; res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(body)); };

// the Visualizer project folder that contains dir (itself or a parent), if any
function projectAround(dir) {
  let d = path.resolve(dir);
  for (;;) {
    if (fs.existsSync(path.join(d, "projectProperties.json"))) return d;
    const up = path.dirname(d);
    if (up === d) return null;
    d = up;
  }
}

export function outputPlugin() {
  return {
    name: "retrofit-output",
    configureServer(server) {
      // POST /api/output/template { root, dir: "<MA>/…/<name>.sm", files: { "<id>.json": text } }
      server.middlewares.use("/api/output/template", (req, res) => {
        if (!isLocal(req)) return refuse(res, "output writer");
        if (req.method !== "POST") return json(res, 405, { error: "POST only" });
        const chunks = [];
        req.on("data", (c) => chunks.push(c));
        req.on("end", () => {
          try {
            const { root, dir, files } = JSON.parse(Buffer.concat(chunks).toString("utf8"));
            if (!root || !path.isAbsolute(root)) return json(res, 400, { error: "give the output folder's full path, e.g. C:\\Projects\\KBZ\\R26-merged" });
            const segs = String(dir || "").split(/[\\/]/).filter(Boolean);
            if (segs.length < 2 || segs.some((s) => s === ".." || s === ".") || !/\.sm$/i.test(segs[segs.length - 1])) return json(res, 400, { error: "bad template folder" });
            const base = path.resolve(root);
            const dest = path.resolve(base, ...segs);
            if (!dest.startsWith(base + path.sep)) return json(res, 400, { error: "path outside the output folder" });
            const inside = projectAround(path.dirname(dest)) || projectAround(base);
            if (inside) return json(res, 400, { error: `${inside} is a Visualizer project — choose a separate output folder (nothing was written)` });
            const names = Object.keys(files || {});
            if (!names.length || names.some((n) => !/^[^\\/:*?"<>|]+\.json$/i.test(n))) return json(res, 400, { error: "bad file list" });
            // the template folder is written whole: anything left from an earlier run is removed first
            fs.rmSync(dest, { recursive: true, force: true });
            fs.mkdirSync(dest, { recursive: true });
            for (const n of names) fs.writeFileSync(path.join(dest, n), files[n], "utf8");
            json(res, 200, { ok: true, path: dest, written: names.length });
          } catch (e) { json(res, 500, { error: String((e && e.message) || e) }); }
        });
      });
      // POST /api/output/file { root, path: "<MA>/controllers/<ch>/…/<name>Controller.js", text } — one controller file
      // (CtrlSync), replaced if it is there; the rest of its folder is left alone
      server.middlewares.use("/api/output/file", (req, res) => {
        if (!isLocal(req)) return refuse(res, "output writer");
        if (req.method !== "POST") return json(res, 405, { error: "POST only" });
        const chunks = [];
        req.on("data", (c) => chunks.push(c));
        req.on("end", () => {
          try {
            const { root, path: rel, text } = JSON.parse(Buffer.concat(chunks).toString("utf8"));
            if (!root || !path.isAbsolute(root)) return json(res, 400, { error: "give the output folder's full path, e.g. C:\\Projects\\KBZ\\R26-merged" });
            const segs = String(rel || "").split(/[\\/]/).filter(Boolean);
            if (segs.length < 3 || segs.some((s) => s === ".." || s === "." || /[:*?"<>|]/.test(s)) || !segs.some((s) => s.toLowerCase() === "controllers") || !/Controller\.js$/i.test(segs[segs.length - 1])) return json(res, 400, { error: "bad controller path" });
            if (typeof text !== "string") return json(res, 400, { error: "no file text" });
            const base = path.resolve(root);
            const dest = path.resolve(base, ...segs);
            if (!dest.startsWith(base + path.sep)) return json(res, 400, { error: "path outside the output folder" });
            const inside = projectAround(path.dirname(dest)) || projectAround(base);
            if (inside) return json(res, 400, { error: `${inside} is a Visualizer project — choose a separate output folder (nothing was written)` });
            fs.mkdirSync(path.dirname(dest), { recursive: true });
            fs.writeFileSync(dest, text, "utf8");
            json(res, 200, { ok: true, path: dest, bytes: Buffer.byteLength(text, "utf8") });
          } catch (e) { json(res, 500, { error: String((e && e.message) || e) }); }
        });
      });
    },
  };
}
