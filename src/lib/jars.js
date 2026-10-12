// Java JAR comparison for the Fabric workspace.
// Two levels, both covering every jar:
//   1. bytecode — in the browser, always available: each class is disassembled (classfile.js) and compared by a
//      signature of its readable listing, so recompiled-but-identical code is told apart from real changes;
//   2. decompiled Java source — Vineflower on the local dev server (server/decompiler.js); results cached by jar hash.
import { unzipSync } from "fflate";
import { classModel, classText, jarBase, jarVersion } from "./classfile.js";
import { hash } from "./filediff.js";

export { jarBase, jarVersion };

// bytes -> short content hash (53-bit, same family as filediff.hash)
export function byteHash(b) {
  let h1 = 0xdeadbeef ^ b.length, h2 = 0x41c6ce57 ^ b.length;
  for (let i = 0; i < b.length; i++) { h1 = Math.imul(h1 ^ b[i], 2654435761); h2 = Math.imul(h2 ^ b[i], 1597334677); }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return b.length + ":" + (4294967296 * (2097151 & h2) + (h1 >>> 0));
}

// resources whose differences come from the build, not the code (shown, but flagged)
export const isBuildInfo = (p) => /^META-INF\/(MANIFEST\.MF|maven\/.*\/pom\.properties|INDEX\.LIST)$/i.test(p);
const TEXT_RES = /\.(xml|properties|json|txt|html?|css|js|sql|MF|yml|yaml|xsd|wsdl|vm|ftl|csv|list|factories|conf|LIST)$|^META-INF\/services\//i;
export const isTextRes = (p) => TEXT_RES.test(p);
const decoder = new TextDecoder("utf-8");
export const resText = (b) => decoder.decode(b).replace(/\r\n?/g, "\n");

// ---------------------------------------------------------------- one export: the _JARs folder
// jars: Map(name -> File), metas: Map(jar name without .jar -> File), svcMetas: [[service rel, File]]
export function jarsOf(scan) {
  const jars = new Map(), metas = new Map(), svcMetas = [];
  for (const [rel, f] of scan.files) {
    if (rel.startsWith("_JARs/") && /\.meta\.json$/i.test(rel)) metas.set(rel.slice(6).replace(/\.meta\.json$/i, ""), f);
    else if (/^_(Integration|ObjectServices|Orchestration|Identity|WorkflowServices)\/[^/]+\/[^/]+\/Meta\.json$/.test(rel)) svcMetas.push([rel, f]);
  }
  for (const [name, f] of scan.jarFiles || []) jars.set(name, f);
  return { jars, metas, svcMetas };
}

const SVC_TYPE = { _Integration: "Integration", _ObjectServices: "Object", _Orchestration: "Orchestration", _Identity: "Identity", _WorkflowServices: "Workflow" };

// Index every jar of one export: per class a signature of the readable bytecode (version line excluded),
// per resource a byte hash. Models are not kept — a jar is re-read when it is opened.
export async function indexExport(scan, onProgress) {
  const { jars, metas, svcMetas } = jarsOf(scan);
  const out = { jars: {}, usedBy: {}, deps: {} };
  // which services use which jar (service Meta.json "jars": [{name}])
  for (const [rel, f] of svcMetas) {
    try {
      const j = JSON.parse(await f.text());
      for (const x of j.jars || []) {
        const s = rel.split("/");
        (out.usedBy[x.name] ||= []).push(`${SVC_TYPE[s[0]]}/${s[1]}`);
      }
    } catch { /* unreadable meta: no usage info */ }
  }
  for (const [name, f] of metas) {
    try { const j = JSON.parse(await f.text()); if (j.dependentJars && j.dependentJars.length) out.deps[`${name}.jar`] = j.dependentJars; } catch { /* ignore */ }
  }
  const names = [...jars.keys()].sort();
  let done = 0;
  for (const name of names) {
    if (onProgress) onProgress({ done, total: names.length, jar: name });
    await new Promise((r) => setTimeout(r));
    const f = jars.get(name);
    const j = { name, base: jarBase(name), version: jarVersion(name), size: f.size, classes: {}, resources: {}, error: null };
    try {
      const buf = new Uint8Array(await f.arrayBuffer());
      j.sha = byteHash(buf);
      const z = unzipSync(buf);
      for (const [p, b] of Object.entries(z)) {
        if (p.endsWith("/")) continue;
        if (p.endsWith(".class")) {
          let sig, ver = "", err = null;
          try { const m = classModel(b); ver = m.version; sig = hash(classText({ ...m, version: "" })); } catch (e) { err = String(e.message || e); sig = "bytes:" + byteHash(b); }
          j.classes[p] = { bytes: byteHash(b), sig, ver, err };
        } else j.resources[p] = { bytes: byteHash(b), size: b.length };
      }
    } catch (e) { j.error = String(e.message || e); }
    out.jars[name] = j;
    done++;
  }
  if (onProgress) onProgress({ done, total: names.length, running: false });
  return out;
}

// Indexing once per picked export (kept while the export stays loaded), with progress for the UI.
const idxCache = new WeakMap();
export function indexCached(scan) {
  if (!idxCache.has(scan)) {
    const e = { progress: { done: 0, total: (scan.jarFiles || new Map()).size }, result: null, error: null };
    e.promise = indexExport(scan, (p) => { e.progress = p; emit(); })
      .then((r) => { e.result = r; emit(); return r; }, (err) => { e.error = String(err.message || err); emit(); });
    idxCache.set(scan, e);
  }
  return idxCache.get(scan);
}

// ---------------------------------------------------------------- pairing + comparison of two exports
// jars are matched by exact name, then by library name without version (dom4j-2.1.3 ↔ dom4j-2.1.4)
export function pairJars(A, B) {
  const rows = [], usedB = new Set();
  const bByName = new Map(Object.keys(B.jars).map((n) => [n, n]));
  const bByBase = new Map();
  for (const n of Object.keys(B.jars)) (bByBase.get(jarBase(n)) || bByBase.set(jarBase(n), []).get(jarBase(n))).push(n);
  for (const a of Object.keys(A.jars).sort()) {
    let b = bByName.get(a);
    if (!b || usedB.has(b)) { const c = (bByBase.get(jarBase(a)) || []).filter((x) => !usedB.has(x)); b = c.length === 1 ? c[0] : null; }
    if (b) usedB.add(b);
    rows.push([a, b]);
  }
  for (const b of Object.keys(B.jars).sort()) if (!usedB.has(b)) rows.push([null, b]);
  return rows;
}

// class status: same (identical bytes) · rebuilt (same code, different bytes) · changed · onlyA · onlyB
function classStatus(a, b) {
  if (!a) return "onlyB";
  if (!b) return "onlyA";
  if (a.bytes === b.bytes) return "same";
  return a.sig === b.sig ? "rebuilt" : "changed";
}
const resStatus = (a, b) => (!a ? "onlyB" : !b ? "onlyA" : a.bytes === b.bytes ? "same" : "changed");

export function compareJars(A, B) {
  const rows = pairJars(A, B).map(([na, nb]) => {
    const a = na ? A.jars[na] : null, b = nb ? B.jars[nb] : null;
    const r = { key: (a || b).base + (a && b ? "" : na ? "@A" : "@B"), base: (a || b).base, names: [na, nb], versions: [a ? a.version : null, b ? b.version : null], sizes: [a ? a.size : 0, b ? b.size : 0],
      usedBy: [na ? A.usedBy[na] || [] : [], nb ? B.usedBy[nb] || [] : []], deps: [na ? A.deps[na] || [] : [], nb ? B.deps[nb] || [] : []],
      error: (a && a.error) || (b && b.error) || null, classes: [], resources: [], counts: {} };
    if (!a || !b) { r.status = a ? "onlyA" : "onlyB"; r.nClasses = [a ? Object.keys(a.classes).length : 0, b ? Object.keys(b.classes).length : 0]; return r; }
    r.nClasses = [Object.keys(a.classes).length, Object.keys(b.classes).length];
    if (a.sha === b.sha) { r.status = "identical"; return r; }
    for (const p of new Set([...Object.keys(a.classes), ...Object.keys(b.classes)])) {
      const st = classStatus(a.classes[p], b.classes[p]);
      r.counts[st] = (r.counts[st] || 0) + 1;
      if (st !== "same") r.classes.push({ path: p, status: st, vers: [a.classes[p]?.ver, b.classes[p]?.ver] });
    }
    for (const p of new Set([...Object.keys(a.resources), ...Object.keys(b.resources)])) {
      const st = resStatus(a.resources[p], b.resources[p]);
      if (st === "same") continue;
      const build = isBuildInfo(p);
      r.counts[build ? "build" : "res"] = (r.counts[build ? "build" : "res"] || 0) + 1;
      r.resources.push({ path: p, status: st, build });
    }
    const real = (r.counts.changed || 0) + (r.counts.onlyA || 0) + (r.counts.onlyB || 0) + (r.counts.res || 0);
    r.status = real ? "changed" : "samecode";
    r.classes.sort((x, y) => x.path.localeCompare(y.path));
    r.resources.sort((x, y) => x.path.localeCompare(y.path));
    return r;
  });
  return { rows };
}

// ---------------------------------------------------------------- 3-way retrofit (base · customised · new release)
// Per class / resource, by signature across the three exports (jars matched by library name).
export function jarRetrofit(idx) {
  const by = idx.map((x) => { const m = new Map(); for (const j of Object.values(x.jars)) if (!m.has(j.base)) m.set(j.base, j); return m; });
  const bases = new Set(by.flatMap((m) => [...m.keys()]));
  const rows = [];
  let targetOnly = 0;
  for (const base of bases) {
    const J = by.map((m) => m.get(base) || null);
    if (J[0] && !J[1]) { // the whole jar is not in the customised export: one row, not one per class
      rows.push({ key: `${base}/`, base, path: "(whole jar)", kind: "jar", jars: J.map((j) => (j ? j.name : null)), bucket: "R", note: J[2] ? "not in the customised export, still in the new release" : "not in the customised export nor in the new release" });
      continue;
    }
    const items = new Set();
    for (const j of J) if (j) { for (const p of Object.keys(j.classes)) items.add(p); for (const p of Object.keys(j.resources)) if (!isBuildInfo(p)) items.add(p); }
    for (const p of items) {
      const v = J.map((j) => (j ? (j.classes[p] ? j.classes[p].sig : j.resources[p] ? j.resources[p].bytes : null) : null));
      const [b, c, t] = v;
      let bucket = null, note = "";
      if (b && c && b !== c) {
        if (!t) { bucket = "?"; note = "changed in the customised version, missing in the new release"; }
        else if (t === c) { bucket = "3"; note = "the new release already matches the customised version"; }
        else if (t === b) { bucket = "1"; note = "the new release left it unchanged — re-apply the customisation"; }
        else { bucket = "2"; note = "changed in both — merge by hand"; }
      } else if (!b && c) {
        if (!t) { bucket = "4"; note = "only in the customised version — port as new"; }
        else if (t === c) { bucket = "3"; note = "the new release already has the same code"; }
        else { bucket = "2"; note = "added in both, differently — merge by hand"; }
      } else if (b && !c && J[1]) {
        bucket = "R"; note = t ? "removed in the customised version, still in the new release" : "removed in the customised version and in the new release";
      } else if ((b && t && b !== t) || (!b && !c && t)) targetOnly++;
      if (bucket) rows.push({ key: `${base}/${p}`, base, path: p, kind: p.endsWith(".class") ? "class" : "resource", jars: J.map((j) => (j ? j.name : null)), bucket, note });
    }
  }
  return { rows, targetOnly };
}

// ---------------------------------------------------------------- opening one jar pair (bytecode models + resources)
const opened = new Map(); // File -> Promise<{ entries }>
export function openJar(file) {
  if (!opened.has(file)) opened.set(file, file.arrayBuffer().then((b) => unzipSync(new Uint8Array(b))));
  if (opened.size > 12) opened.delete(opened.keys().next().value); // keep memory bounded
  return opened.get(file);
}
export async function classPair(files, path) {
  const z = await Promise.all(files.map((f) => (f ? openJar(f) : null)));
  return z.map((e) => (e && e[path] ? classModel(e[path]) : null));
}
export async function resourcePair(files, path) {
  const z = await Promise.all(files.map((f) => (f ? openJar(f) : null)));
  return z.map((e) => (e && e[path] ? (isTextRes(path) ? resText(e[path]) : { binary: e[path].length, hash: byteHash(e[path]) }) : null));
}
export { classText };

// member-level differences of a class pair: [{ key, label, kind, status }]
export function memberDiff(ma, mb) {
  const keys = new Set([...Object.keys(ma ? ma.members : {}), ...Object.keys(mb ? mb.members : {})]);
  const out = [];
  for (const k of keys) {
    const a = ma && ma.members[k], b = mb && mb.members[k];
    const status = !a ? "onlyB" : !b ? "onlyA" : a.text === b.text ? "same" : "changed";
    out.push({ key: k, label: (a || b).label, kind: (a || b).kind, status, a: a ? a.text : null, b: b ? b.text : null });
  }
  return out.sort((x, y) => (x.kind === "field") - (y.kind === "field") || x.label.localeCompare(y.label));
}

// ---------------------------------------------------------------- decompiled source (Vineflower via the dev server)
// One shared store so decompiles survive navigation; subscribers re-render on every change.
const dc = { status: null, byFile: new Map(), listeners: new Set(), queue: [], busy: false };
const emit = () => dc.listeners.forEach((f) => f());
export function subscribeDecompile(f) { dc.listeners.add(f); return () => dc.listeners.delete(f); }
export const decompileState = (file) => (file ? dc.byFile.get(file) || null : null);
export const decompilerStatus = () => dc.status;

export async function loadDecompilerStatus() {
  if (dc.status) return dc.status;
  try {
    const r = await fetch("/api/decompiler/status");
    dc.status = r.ok && /json/.test(r.headers.get("content-type") || "") ? await r.json() : { available: false, reason: "the decompile service runs with the dev server (npm run dev) — not in this build" };
  } catch (e) { dc.status = { available: false, reason: `decompile service not reachable (${e.message})` }; }
  emit();
  return dc.status;
}

// queue jars for decompiling (in the given order); already queued / done jars are skipped
export function requestDecompile(items /* [{file, name}] */) {
  for (const it of items) {
    if (!it.file || dc.byFile.has(it.file)) continue;
    dc.byFile.set(it.file, { state: "queued", name: it.name });
    dc.queue.push(it);
  }
  emit();
  pump();
}
// move a jar to the front (the one being looked at)
export function prioritise(files) {
  const want = files.filter(Boolean);
  dc.queue.sort((x, y) => want.includes(y.file) - want.includes(x.file));
}
async function pump() {
  if (dc.busy) return;
  const st = await loadDecompilerStatus();
  if (!st.available) {
    for (const it of dc.queue) dc.byFile.set(it.file, { state: "unavailable", name: it.name });
    dc.queue = []; emit(); return;
  }
  dc.busy = true;
  while (dc.queue.length) {
    const it = dc.queue.shift();
    dc.byFile.set(it.file, { state: "running", name: it.name, t0: Date.now() });
    emit();
    try {
      const r = await fetch("/api/decompile", { method: "POST", headers: { "x-jar-name": encodeURIComponent(it.name), "Content-Type": "application/octet-stream" }, body: it.file });
      const j = await r.json();
      if (!r.ok || j.error) throw new Error(j.error || `HTTP ${r.status}`);
      for (const k of Object.keys(j.files)) j.files[k] = j.files[k].replace(/\r\n?/g, "\n");
      dc.byFile.set(it.file, { state: "done", name: it.name, data: j });
    } catch (e) {
      dc.byFile.set(it.file, { state: "error", name: it.name, error: String(e.message || e) });
    }
    emit();
  }
  dc.busy = false;
}
export function resetDecompile() { dc.byFile.clear(); dc.queue = []; emit(); }

// .java file comparison of two decompiled jars: [{ path, status }]
export function sourceDiff(da, db) {
  const out = [];
  const fa = da ? da.files : {}, fb = db ? db.files : {};
  for (const p of new Set([...Object.keys(fa), ...Object.keys(fb)])) {
    if (!p.endsWith(".java")) continue;
    const a = fa[p], b = fb[p];
    out.push({ path: p, status: a == null ? "onlyB" : b == null ? "onlyA" : a === b ? "same" : "changed" });
  }
  return out.sort((x, y) => x.path.localeCompare(y.path));
}
