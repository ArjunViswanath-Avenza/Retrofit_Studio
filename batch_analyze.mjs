// Batch controller analysis across three Kony/Temenos project trees.
// Usage: node batch_analyze.mjs
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from "fs";
import { join, relative, sep } from "path";
import { extract, buildModel } from "./src/lib/analyzer.js";

const PROJECTS = {
  R21: "C:/Users/Admin/Downloads/202107/Desktop Web/adminConsole/controllers",
  KBZ: "C:/Users/Admin/Downloads/kbzscm-spotlight2021-0179b474c904/controllers",
  R26: "C:/Users/Admin/Downloads/R26.0.2/adminConsole/controllers",
};
const ORDER = ["R21", "KBZ", "R26"]; // base, custom, new
const OUT = "C:/Users/Admin/Downloads/KBZ_Controllers_Analysis";

function walk(dir, acc = []) {
  let entries;
  try { entries = readdirSync(dir); } catch { return acc; }
  for (const e of entries) {
    const p = join(dir, e);
    let st;
    try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) walk(p, acc);
    else if (e.endsWith("Controller.js") && !e.endsWith("ControllerActions.js")) acc.push(p);
  }
  return acc;
}

// index each project's controllers by relative path (forward slashes)
const index = {};
for (const tag of ORDER) {
  index[tag] = new Map();
  for (const f of walk(PROJECTS[tag])) {
    const rel = relative(PROJECTS[tag], f).split(sep).join("/");
    index[tag].set(rel, f);
  }
  console.log(`${tag}: ${index[tag].size} controllers`);
}

// union of all relative paths
const allRel = [...new Set(ORDER.flatMap((t) => [...index[t].keys()]))].sort();
console.log(`total distinct controllers: ${allRel.length}`);

mkdirSync(OUT, { recursive: true });

const summary = [["controller", "path", "inR21", "inKBZ", "inR26", "mR21", "mKBZ", "mR26", "changes_KBZ_vs_R21", "b1", "b2", "b3", "b4", "b5", "status"]];
const changes = [["controller", "member", "change", "bucket", "in_R26", "note"]];
let okCount = 0, errCount = 0, skipCount = 0;
const agg = { changes: 0, buckets: {} };

for (const rel of allRel) {
  const name = rel.split("/").pop().replace(/\.js$/, "");
  const inR21 = index.R21.has(rel), inKBZ = index.KBZ.has(rel), inR26 = index.R26.has(rel);
  // need base (R21) + custom (KBZ) to compute the retrofit delta
  if (!inR21 || !inKBZ) {
    skipCount++;
    summary.push([name, rel, inR21, inKBZ, inR26, "", "", "", "", "", "", "", "", "", inR21 || inKBZ ? "only-one-side" : ""]);
    continue;
  }
  try {
    const files = ORDER.filter((t) => index[t].has(rel)).map((t) => {
      const src = readFileSync(index[t].get(rel), "utf8");
      return { label: t, name: rel, src, parsed: extract(src) };
    });
    // ensure order base,custom,new
    files.sort((a, b) => ORDER.indexOf(a.label) - ORDER.indexOf(b.label));
    const m = buildModel(files);
    const bc = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    Object.values(m.members).forEach((x) => { if (x.bucket && bc[x.bucket] !== undefined) bc[x.bucket]++; });
    summary.push([name, rel, inR21, inKBZ, inR26,
      m.counts.R21 ?? "", m.counts.KBZ ?? "", m.counts.R26 ?? "",
      m.genuine.length, bc[1], bc[2], bc[3], bc[4], bc[5], "ok"]);
    for (const n of m.genuine) {
      const x = m.members[n];
      changes.push([name, n, x.change, x.bucket, x.inNew || "", (x.note || "").replace(/\s+/g, " ")]);
    }
    agg.changes += m.genuine.length;
    for (const k of [1, 2, 3, 4, 5]) agg.buckets[k] = (agg.buckets[k] || 0) + bc[k];
    okCount++;
  } catch (e) {
    errCount++;
    summary.push([name, rel, inR21, inKBZ, inR26, "", "", "", "", "", "", "", "", "", "ERR: " + String(e.message || e).slice(0, 80)]);
  }
}

const toCsv = (rows) => rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
writeFileSync(join(OUT, "summary.csv"), toCsv(summary), "utf8");
writeFileSync(join(OUT, "changes.csv"), toCsv(changes), "utf8");

console.log("\n===== DONE =====");
console.log(`analyzed (R21+KBZ present): ${okCount} | parse errors: ${errCount} | skipped (one-side only): ${skipCount}`);
console.log(`total genuine changes (KBZ vs R21): ${agg.changes}`);
console.log(`bucket totals: ${[1, 2, 3, 4, 5].map((k) => (agg.buckets[k] || 0)).join(" / ")}  (1=clean re-apply, 2=conflict, 3=already in R26, 4=custom-only, 5=R26-only)`);
console.log(`\noutput -> ${OUT}\\summary.csv  and  changes.csv`);
