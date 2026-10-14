// Command-line converter: runs the same conversion as the Converter workspace (src/lib/convert.js) and writes
// with the file system, then checks the composite app on disk.
// usage: node scripts/convert-cli.mjs <monolith dir> <R26 dir> <out dir> [web|mobile] [plan.json] [--split Module=PrimaryApp ...] [--layout r26]
//   --layout r26  R26 layout: every form goes to the micro app + module R26 keeps it in, under R26's module name
//   plan.json  optional — a conversion-summary.json from an earlier run, to reuse its module -> micro app plan
//   --split    split a module the way R26 does: each form goes to the micro app R26 keeps it in, forms R26 does not
//              have (and the module's own name for getModule) go to PrimaryApp
import fs from "node:fs";
import path from "node:path";
import { scanFolder } from "../src/lib/scan.js";
import { scanMicroApps } from "../src/lib/microapps.js";
import { rawFiles, proposePlan, convert, checkComposite, r26Layout } from "../src/lib/convert.js";
import { inventory, r26Split } from "../src/lib/mapplan.js";

const args = process.argv.slice(2);
const splits = [];
let layoutMode = null;
{ const i = args.indexOf("--layout"); if (i >= 0) { layoutMode = args[i + 1]; args.splice(i, 2); } }
for (let i = args.indexOf("--split"); i >= 0; i = args.indexOf("--split")) { splits.push(args[i + 1]); args.splice(i, 2); }
const [mono, r26, outDir, channel = "web", planFile] = args;
if (!mono || !r26 || !outDir) { console.error("usage: node scripts/convert-cli.mjs <monolith dir> <R26 dir> <out dir> [web|mobile] [plan.json]"); process.exit(1); }
if (fs.existsSync(outDir) && fs.readdirSync(outDir).length) { console.error(`${outDir} is not empty — pick a new folder`); process.exit(1); }

const SKIP = new Set([".git", "node_modules", "jssrc", "binaries", "build", "temp", "ssm_temp"]);
// File-like objects read lazily from disk (the browser gives the converter File objects with webkitRelativePath)
function filesOf(root) {
  const base = path.basename(path.resolve(root)), list = [];
  const walk = (dir, rel) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name), r = `${rel}/${e.name}`;
      if (e.isDirectory()) { if (!SKIP.has(e.name)) walk(p, r); }
      else list.push({ name: e.name, webkitRelativePath: r, path: p, get size() { return fs.statSync(p).size; }, text: () => fs.promises.readFile(p, "utf8"), arrayBuffer: () => fs.promises.readFile(p).then((b) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)) });
    }
  };
  walk(root, base);
  return list;
}

const t0 = Date.now();
const log = (m) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s] ${m}`);
log("scanning the monolith…");
const monoList = filesOf(mono);
const raw = rawFiles(monoList);
log(`${raw.files.length} monolith files`);
log("scanning the micro-app reference…");
const ma = scanMicroApps(filesOf(r26), scanFolder);
log(`${ma.apps.size} reference projects`);

let plan = await proposePlan(scanFolder(monoList), raw.files, ma, channel);
if (planFile) {
  const prev = JSON.parse(fs.readFileSync(planFile, "utf8"));
  const target = new Map(prev.plan.map((r) => [r.module, r.target]));
  plan = { ...plan, rows: plan.rows.map((r) => (target.has(r.module) ? { ...r, target: target.get(r.module) } : r)) };
  log(`plan taken from ${planFile} (${target.size} modules)`);
}
if (splits.length) {
  const inv = inventory(raw.files, channel);
  plan.formTargets = {};
  for (const sp of splits) {
    const [module, primary] = sp.split("=");
    const { targets, detail } = r26Split(inv, channel, module, primary);
    plan.rows = plan.rows.map((r) => (r.module === module ? { ...r, target: primary } : r));
    Object.assign(plan.formTargets, targets);
    log(`split ${module} (primary ${primary}):`);
    for (const d of detail) console.log(`    ${d.form.padEnd(28)} -> ${d.app.padEnd(24)} (R26: ${d.r26})`);
  }
}
if (layoutMode === "r26") {
  plan.layout = await r26Layout(raw.files, ma, channel);
  const L = plan.layout;
  log(`R26 layout: ${L.parts.length} module parts in ${new Set(L.parts.map((p) => p.app)).size} micro apps (${L.parts.filter((p) => p.r26).length} with R26 module names, ${L.ties} identical-copy ties)`);
  for (const p of [...L.parts].sort((a, b) => a.app.localeCompare(b.app) || a.name.localeCompare(b.name))) console.log(`    ${p.app.padEnd(24)} ${p.name.padEnd(36)} <- ${p.module.padEnd(32)} ${p.forms.length} form(s)${p.r26 ? "" : "  [kept monolith name]"}`);
  for (const n of L.notes) console.log(`    note: ${n.message}`);
}
log(`converting (${plan.rows.length} modules)…`);
let last = "";
const res = await convert(raw.files, ma, plan, (p) => { if (p.step !== last) { last = p.step; log(p.step); } });

log(`writing ${res.out.length} files to ${outDir}…`);
let n = 0;
for (const o of res.out) {
  const dest = path.join(outDir, ...o.path.split("/"));
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  if (o.text != null) fs.writeFileSync(dest, o.text);
  else if (o.f.path) fs.copyFileSync(o.f.path, dest);
  else fs.writeFileSync(dest, Buffer.from(await o.f.arrayBuffer()));
  if (++n % 20000 === 0) log(`  ${n} written`);
}
log("checking the composite app on disk…");
const read = async (rel) => { const p = path.join(outDir, ...rel.split("/")); return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : null; };
const rows = await checkComposite(res.projects, res.roles, read);
for (const r of rows) console.log(`${r.ok ? "OK  " : "FAIL"} ${r.role.padEnd(9)} ${r.project.padEnd(26)} ${r.checks.filter((c) => !c.ok).map((c) => `${c.name}: ${c.detail || "no"}`).join("; ")}`);
log(`${rows.filter((r) => r.ok).length}/${rows.length} projects linked · ${res.rewrites.length} rewrites · ${res.warnings.length} warnings`);
