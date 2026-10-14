// Local write service for the Converter (dev server only).
// The browser writes the converted projects into a picked folder (File System Access API); files it refuses — the
// project.manifest files that link a composite app have been seen to go missing that way — are re-sent here and
// written with the file system. Writes stay inside the given folder, and only into project folders that already
// exist there.
import fs from "node:fs";
import path from "node:path";

export function writerPlugin() {
  return {
    name: "retrofit-writer",
    configureServer(server) {
      server.middlewares.use("/api/write-file", (req, res) => {
        if (req.method !== "POST") { res.statusCode = 405; res.end(); return; }
        const chunks = [];
        req.on("data", (c) => chunks.push(c));
        req.on("end", () => {
          const fail = (code, error) => { res.statusCode = code; res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify({ error })); };
          try {
            const { root, path: rel, text, base64 } = JSON.parse(Buffer.concat(chunks).toString("utf8"));
            if (!root || !path.isAbsolute(root) || !fs.existsSync(root) || !fs.statSync(root).isDirectory()) return fail(400, `folder not found: ${root}`);
            const segs = String(rel || "").split(/[\\/]/).filter(Boolean);
            if (!segs.length || segs.some((s) => s === ".." || s === ".")) return fail(400, "bad path");
            const dest = path.resolve(root, ...segs);
            if (!dest.startsWith(path.resolve(root) + path.sep)) return fail(400, "path outside the folder");
            if (segs.length > 1 && !fs.existsSync(path.join(root, segs[0]))) return fail(400, `${segs[0]} is not in ${root} — is this the folder you converted into?`);
            fs.mkdirSync(path.dirname(dest), { recursive: true });
            fs.writeFileSync(dest, base64 != null ? Buffer.from(base64, "base64") : String(text ?? ""));
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ ok: true }));
          } catch (e) { fail(500, String(e.message || e)); }
        });
      });
    },
  };
}
