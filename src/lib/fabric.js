// LoomSync: compare two exported Quantum/Volt MX Fabric apps (KBZ vs R26), service by service.
//
// Export layout (verified on KonyBankingAdminConsole 202107.05 and 26.0.2):
//   Apps/Version.json                                   Fabric version the app was exported from
//   Apps/<App>/Meta.json                                app manifest (service lists)
//   Apps/_Identity/<svc>/Meta.json                      identity provider (config = JSON stored as a string)
//   Apps/_Integration/<svc>/<ver>/Meta.json             service settings (jars used)
//                               /Endpoints/<ep>.xml     endpoint (type, url, config entries)
//                               /Operations/<op>.xml    operation (service attrs, config-params, input/output params)
//   Apps/_ObjectServices/<svc>/<ver>/Meta.json          service settings
//                               /_Endpoints/<ep>.json   data-adapter endpoint
//                               /MappingSets.json
//                               /<object>/Meta.json + Fields.json + Relationships.json   object definition
//                               /<object>/Operations/<verb>Mapping.json                  verb -> backend mapping
//   Apps/_Orchestration/<svc>/<ver>/<op>.xml            composite / looping operation (steps = config-param "service")
//   Apps/_WorkflowServices/<svc>/<ver>/Meta.json, Endpoints/*.json, ModelLayout/*.json
//   Apps/_JARs/                                         ignored (jars + their meta) for now
//   lockConfig.json                                     ignored (written by newer Fabric exports only)
//
// Every comparable unit is flattened to { property path -> string value }. Embedded JSON / XML stored in
// strings (identity config, entitymetadata, iMapping...) is parsed and flattened too, and arrays of named
// things are keyed by name, so a shifted list doesn't show as everything changed.
// Each changed property is categorised:
//   logic       real behaviour / contract change (counted)
//   environment credentials, hosts, pool sizes - differ per environment (counted separately; secrets masked)
//   format      differences produced by the Fabric version that wrote the export, not by anyone's change
//               (isExtended/customOperation flags, param order numbers, etags, designer layout, mirrored mapperData)
// A property present on one side only with a default value ("", false, null, [], {}) is treated as equal.

// ---------------------------------------------------------------- minimal XML parser
const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const decode = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (m, e) => {
  if (e[0] === "#") return String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
  return ENT[e.toLowerCase()] ?? m;
});

export function parseXml(src) {
  const root = { tag: "#doc", attrs: {}, children: [], text: "" };
  const stack = [root];
  let i = 0;
  const n = src.length;
  while (i < n) {
    const lt = src.indexOf("<", i);
    if (lt < 0) { stack[stack.length - 1].text += decode(src.slice(i)); break; }
    if (lt > i) stack[stack.length - 1].text += decode(src.slice(i, lt));
    if (src.startsWith("<?", lt)) { i = src.indexOf("?>", lt) + 2; continue; }
    if (src.startsWith("<!--", lt)) { i = src.indexOf("-->", lt) + 3; continue; }
    if (src.startsWith("<![CDATA[", lt)) { const e = src.indexOf("]]>", lt); stack[stack.length - 1].text += src.slice(lt + 9, e); i = e + 3; continue; }
    if (src.startsWith("<!", lt)) { i = src.indexOf(">", lt) + 1; continue; }
    if (src[lt + 1] === "/") { stack.pop(); i = src.indexOf(">", lt) + 1; continue; }
    let j = lt + 1;
    while (j < n && !/[\s/>]/.test(src[j])) j++;
    const el = { tag: src.slice(lt + 1, j), attrs: {}, children: [], text: "" };
    let selfClose = false;
    for (;;) {
      while (j < n && /\s/.test(src[j])) j++;
      if (src[j] === "/") { selfClose = true; j = src.indexOf(">", j) + 1; break; }
      if (src[j] === ">") { j++; break; }
      let k = j;
      while (k < n && !/[\s=/>]/.test(src[k])) k++;
      const name = src.slice(j, k);
      while (k < n && /\s/.test(src[k])) k++;
      if (src[k] !== "=") { el.attrs[name] = ""; j = k; continue; }
      k++;
      while (k < n && /\s/.test(src[k])) k++;
      const q = src[k];
      const end = src.indexOf(q, k + 1);
      el.attrs[name] = decode(src.slice(k + 1, end));
      j = end + 1;
    }
    stack[stack.length - 1].children.push(el);
    if (!selfClose) stack.push(el);
    i = j;
  }
  return root.children[0] || null;
}

// pretty XML text for display of XML stored inside a string (iMapping etc.)
export function prettyXml(el, ind = "") {
  if (!el) return "";
  const at = Object.entries(el.attrs).map(([k, v]) => ` ${k}="${v}"`).join("");
  const t = el.text.trim();
  if (!el.children.length) return t ? `${ind}<${el.tag}${at}>${t}</${el.tag}>` : `${ind}<${el.tag}${at}/>`;
  return [`${ind}<${el.tag}${at}>`, ...el.children.map((c) => prettyXml(c, ind + "  ")), `${ind}</${el.tag}>`].join("\n");
}

// ---------------------------------------------------------------- file layout
export const TYPES = ["Identity", "Integration", "Object", "Orchestration", "Workflow", "App"];
const TOP = { _Identity: "Identity", _Integration: "Integration", _ObjectServices: "Object", _Orchestration: "Orchestration", _WorkflowServices: "Workflow" };

// path of a picked file relative to the export's Apps/ folder (null = not part of an export / ignored)
export function fabricRel(relPath) {
  const segs = (relPath || "").replace(/\\/g, "/").split("/");
  let i = segs.findIndex((s) => s.toLowerCase() === "apps");
  if (i < 0) i = segs.findIndex((s) => s in TOP || s === "_JARs") - 1;
  if (i < -1) return null;
  const rel = segs.slice(i + 1).join("/");
  return rel || null;
}

// a picked export folder (FileList) -> files under Apps/ (jars skipped) + service counts
export function scanFabricFolder(fileList) {
  const files = new Map();
  let jars = 0, outside = 0;
  for (const f of fileList) {
    const rel = fabricRel(f.webkitRelativePath || f.name);
    if (!rel) { outside++; continue; }
    if (/\.jar$/i.test(rel)) { jars++; continue; }
    files.set(rel, f);
  }
  const svcs = {};
  for (const rel of files.keys()) {
    const s = rel.split("/");
    const t = TOP[s[0]];
    if (t && s[1]) (svcs[t] = svcs[t] || new Set()).add(s[1]);
  }
  const appRel = [...files.keys()].find((r) => /^[^_/][^/]*\/Meta\.json$/.test(r));
  return {
    files, fileCount: fileList.length, jars, outside, app: appRel ? appRel.split("/")[0] : null,
    counts: Object.fromEntries(Object.entries(svcs).map(([k, v]) => [k, v.size])),
  };
}

// which comparable unit a file belongs to
export function unitOf(rel) {
  const s = rel.split("/");
  if (s[0] === "_JARs") return null;
  if (s.length === 1) return s[0] === "Version.json" ? { version: true } : null;
  const type = TOP[s[0]];
  if (!type) {
    if (s.length === 2 && s[1] === "Meta.json") return { type: "App", svc: s[0], ver: "", kind: "manifest", id: s[0], file: "Meta.json" };
    return { type: "Other", svc: s[0], ver: "", kind: "file", id: s.slice(1).join("/"), file: s.slice(1).join("/") };
  }
  if (type === "Identity") return { type, svc: s[1], ver: "", kind: "provider", id: s[1], file: s.slice(2).join("/") };
  const svc = s[1], ver = s[2] || "", rest = s.slice(3);
  const u = (kind, id, file) => ({ type, svc, ver, kind, id, file });
  if (!rest.length) return null;
  if (rest.length === 1 && rest[0] === "lockConfig.json") return null;
  if (rest.length === 1 && rest[0] === "Meta.json") return u("service", "Service settings", "Meta.json");
  if (type === "Integration") {
    if (rest[0] === "Endpoints") return u("endpoint", rest[1].replace(/\.xml$/i, ""), rest.join("/"));
    if (rest[0] === "Operations") return u("operation", rest[1].replace(/\.xml$/i, ""), rest.join("/"));
  }
  if (type === "Object") {
    if (rest[0] === "_Endpoints") return u("endpoint", rest[1].replace(/\.json$/i, ""), rest.join("/"));
    if (rest.length === 1 && rest[0] === "MappingSets.json") return u("mappingsets", "Mapping sets", "MappingSets.json");
    if (rest.length === 2 && /^(Meta|Fields|Relationships)\.json$/.test(rest[1])) return u("object", rest[0], rest[1]);
    if (rest[1] === "Operations" && rest[2]) return u("operation", `${rest[0]}.${rest[2].replace(/\.json$/i, "").replace(/Mapping$/, "")}`, rest.join("/"));
  }
  if (type === "Orchestration" && rest.length === 1 && /\.xml$/i.test(rest[0])) return u("operation", rest[0].replace(/\.xml$/i, ""), rest[0]);
  if (type === "Workflow") {
    if (rest[0] === "Endpoints") return u("endpoint", rest[1].replace(/\.json$/i, ""), rest.join("/"));
    if (rest[0] === "ModelLayout") return u("model", rest[1].replace(/\.json$/i, ""), rest.join("/"));
  }
  return u("file", rest.join("/"), rest.join("/"));
}
export const unitKey = (u) => `${u.type}/${u.svc}/${u.ver}::${u.kind}:${u.id}`;

// group a picked export (Map rel -> File) into units
export function unitsOf(files) {
  const units = new Map();
  let versionFile = null;
  for (const [rel, f] of files) {
    const u = unitOf(rel);
    if (!u) continue;
    if (u.version) { versionFile = f; continue; }
    const k = unitKey(u);
    if (!units.has(k)) units.set(k, { ...u, files: {} });
    units.get(k).files[u.file] = { rel, f };
  }
  return { units, versionFile };
}

// ---------------------------------------------------------------- flattening
const SEG = { "service-config": "config", "service-input": "input", "service-output": "output" };
const keyOfEl = (el) => el.attrs.name ?? el.attrs.id ?? el.attrs.outputpath ?? el.attrs.inputpath ?? null;
const textOf = (el, tag) => { const c = el.children.find((x) => x.tag === tag); return c ? c.text.trim() : undefined; };

function put(out, path, v) {
  let p = path || "(value)";
  if (out.has(p)) { let k = 2; while (out.has(`${p}#${k}`)) k++; p = `${p}#${k}`; }
  out.set(p, v);
}

// a string that holds JSON or XML is expanded in place; everything else is a leaf
function putValue(out, path, v) {
  const t = typeof v === "string" ? v.trim() : "";
  if ((t.startsWith("{") && t.endsWith("}")) || (t.startsWith("[") && t.endsWith("]") && t.length > 2)) {
    try { flatJson(JSON.parse(t), path, out); return; } catch { /* not JSON - keep as text */ }
  }
  if (t.startsWith("<") && t.endsWith(">")) {
    const x = parseXml(t);
    if (x) { flatXml(x, `${path}<${x.tag}>`, out); return; }
  }
  put(out, path, v == null ? "null" : String(v));
}

// a relationship in entitymetadata has no name: identify it by target table + join columns
const relKey = (x) => x.targetEntityType && Array.isArray(x.relationshipAttributeTypeList)
  ? `${x.targetEntityType.name}(${x.relationshipAttributeTypeList.map((r) => `${r.sourceEntityAttributeType && r.sourceEntityAttributeType.name}>${r.targetEntityAttributeType && r.targetEntityAttributeType.name}`).join(",")})`
  : undefined;
const KEY_FNS = [
  (x) => x.name, (x) => x.id, (x) => x.propertyKey, (x) => x.key, (x) => x.sourceFieldName,
  (x) => x.targetEntityType && x.targetEntityType.name, relKey, (x) => x.entityType && x.entityType.name,
];
function keyFnFor(arr) {
  if (!arr.every((x) => x && typeof x === "object" && !Array.isArray(x))) return null;
  for (const f of KEY_FNS) {
    const ks = arr.map(f);
    if (ks.every((k) => typeof k === "string" || typeof k === "number") && new Set(ks).size === ks.length) return f;
  }
  return null;
}

export function flatJson(v, path, out) {
  if (v === null || typeof v !== "object") {
    if (typeof v === "string") putValue(out, path, v);
    else put(out, path, String(v));
    return out;
  }
  if (Array.isArray(v)) {
    if (!v.length) { put(out, path, "[]"); return out; }
    const kf = keyFnFor(v);
    v.forEach((x, i) => flatJson(x, `${path}[${kf ? kf(x) : i}]`, out));
    return out;
  }
  const keys = Object.keys(v);
  if (!keys.length) { put(out, path, "{}"); return out; }
  for (const k of keys) flatJson(v[k], path ? `${path}.${k}` : k, out);
  return out;
}

export function flatXml(el, path, out) {
  for (const [a, v] of Object.entries(el.attrs)) put(out, `${path}@${a}`, v);
  const t = el.text.trim();
  if (t && !el.children.length) putValue(out, path, t);
  const seen = new Map();
  const cfgSeen = new Map(); // config-param name -> values already written (exports repeat e.g. jsonpath="true")
  let step = 0;
  for (const c of el.children) {
    if (c.tag === "entry" && c.children.some((x) => x.tag === "key")) { // endpoint <config><entry><key/><value/></entry>
      putValue(out, `${path}.${textOf(c, "key")}`, textOf(c, "value") ?? "");
      continue;
    }
    if (c.tag === "config-param") {
      const name = c.attrs.name;
      if (name === "service") { // orchestration step, order matters
        step++;
        put(out, `${path}.step ${step}`, `${c.attrs.appid || "?"}${c.attrs["api-version"] ? " v" + c.attrs["api-version"] : ""} → ${c.attrs.value}`);
        continue;
      }
      const vals = cfgSeen.get(name) || new Set();
      if (vals.has(c.attrs.value ?? "")) continue; // identical repeat of the same param: no meaning
      vals.add(c.attrs.value ?? "");
      cfgSeen.set(name, vals);
      putValue(out, `${path}.${name}`, c.attrs.value ?? "");
      for (const [a, v] of Object.entries(c.attrs)) if (a !== "name" && a !== "value" && v) put(out, `${path}.${name}@${a}`, v);
      continue;
    }
    const k = keyOfEl(c);
    const join = (seg) => (path ? `${path}.${seg}` : seg);
    const base = SEG[c.tag] ? join(SEG[c.tag]) : c.tag === "param" && k != null ? join(k) : join(`${c.tag}${k != null ? `:${k}` : ""}`);
    const cnt = (seen.get(base) || 0) + 1;
    seen.set(base, cnt);
    flatXml(c, cnt > 1 ? `${base}#${cnt}` : base, out);
  }
  return out;
}

// ---------------------------------------------------------------- per-unit normalisation
const NAME_SUFFIX = /\d+$/; // object operationConfig.name carries a generated number (getProfiles4415 -> 4780)

// lift fields that only exist inside the single mirrored mapper (operationConfig.mapperData[0]) to the top level
function liftMapper(d) {
  const oc = d && d.operationConfig;
  if (!oc || !Array.isArray(oc.mapperData) || oc.mapperData.length !== 1) return d;
  const m = oc.mapperData[0];
  for (const [k, v] of Object.entries(m)) if (!(k in oc) && k !== "name" && k !== "order") oc[k] = v;
  delete oc.mapperData;
  return d;
}

const isJson = (name) => /\.json$/i.test(name);

// texts: { fileName: text } of one unit on one side -> Map(path -> value)
export function unitProps(unit, texts) {
  const out = new Map();
  if (unit.kind === "object") {
    const d = {};
    for (const n of ["Meta.json", "Fields.json", "Relationships.json"]) if (texts[n] != null) d[n.replace(".json", "").toLowerCase()] = JSON.parse(texts[n]);
    return flatJson(d, "", out);
  }
  for (const [name, text] of Object.entries(texts)) {
    const prefix = Object.keys(texts).length > 1 ? name : "";
    if (isJson(name)) {
      let d = JSON.parse(text);
      if (unit.kind === "operation" && unit.type === "Object") {
        d = liftMapper(d);
        if (d.operationConfig && typeof d.operationConfig.name === "string") d.operationConfig.name = d.operationConfig.name.replace(NAME_SUFFIX, "");
      }
      flatJson(d, prefix, out);
    } else {
      const x = parseXml(text);
      if (x) flatXml(x, prefix, out);
    }
  }
  return out;
}

// ---------------------------------------------------------------- categories
const last = (p) => p.replace(/\[[^\]]*\]/g, "").split(/[.@]/).pop().replace(/#\d+$/, "");
const FORMAT_LEAF = new Set(["isExtended", "customOperation", "customVerb", "enableFrontendUrl", "paramOrder", "parentOrder", "etag", "mapType", "empty", "entityTypeId"]);
const ENV_LEAF = /^(password|passwordExist|userId|jdbcUrl|jdbcClass|maxPoolSize|connectionTimeout|client_secret|client_id|client_pvt_key_jwt|authorization_endpoint|token_endpoint|logout_url|revoke_url|profile_url|custom_idp_url)$/i;
const SECRET_LEAF = /(password|secret|pvt_key|private_key|api_?key)$/i;

export function categoryOf(unit, path) {
  const leaf = last(path);
  if (FORMAT_LEAF.has(leaf)) return "format";
  if (/VisualMappingData/.test(path) || /\.mapperData\[/.test(path)) return "format";
  if (unit.kind === "object" && /^fields\[[^\]]+\]\.id$/.test(path)) return "format"; // R26 export adds a field id
  if (unit.type === "App" && /^meta(\.|$)/.test(path)) return "format"; // lock flag
  if (unit.type === "Identity" && /\.profile\.endpoint\.value$/.test(path)) return "environment";
  if (ENV_LEAF.test(leaf)) return "environment";
  return "logic";
}
export const isSecret = (path) => SECRET_LEAF.test(last(path));
export const mask = (path, v) => (v != null && isSecret(path) && v !== "" ? `•••••• (${String(v).length} chars)` : v);

const DEFAULTS = new Set(["", "false", "null", "[]", "{}"]);

// compare two property maps -> list of changes
export function diffProps(unit, A, B) {
  const changes = [];
  const seen = new Set();
  const paths = [];
  for (const p of A ? A.keys() : []) { seen.add(p); paths.push(p); }
  for (const p of B ? B.keys() : []) if (!seen.has(p)) paths.push(p);
  for (const p of paths) {
    const a = A ? A.get(p) : undefined, b = B ? B.get(p) : undefined;
    if (a === b) continue;
    if (A && B && ((a === undefined && DEFAULTS.has(b)) || (b === undefined && DEFAULTS.has(a)))) continue;
    changes.push({ path: p, a, b, cat: categoryOf(unit, p), op: a === undefined ? "added" : b === undefined ? "removed" : "changed" });
  }
  return changes;
}

// ---------------------------------------------------------------- whole-export analysis
const readTexts = async (u) => {
  if (!u) return null;
  const t = {};
  for (const [name, { f }] of Object.entries(u.files)) t[name] = (await f.text()).replace(/^﻿/, "");
  return t;
};

// references between services: object operation -> backend operation, orchestration step -> operation
function refsOf(unit, props) {
  const out = [];
  if (!props) return out;
  if (unit.type === "Object" && unit.kind === "operation") {
    const s = props.get("operationConfig.backendMeta.serviceName"), o = props.get("operationConfig.backendMeta.operationName");
    if (s && o) out.push({ svc: s, op: o });
  }
  if (unit.type === "Orchestration" && unit.kind === "operation") {
    for (const [p, v] of props) {
      if (!/\.step \d+$/.test(p)) continue;
      const m = v.match(/^(.*?)(?: v[^ ]+)? → (.*)$/);
      if (m) out.push({ svc: m[1], op: m[2] });
    }
  }
  return out;
}

export async function analyzeFabric(exports, labels, onProgress) {
  const sides = exports.map((x) => unitsOf(x.files));
  const version = [];
  for (const s of sides) version.push(s.versionFile ? (JSON.parse(await s.versionFile.text()).version || "?") : null);
  const keys = [...new Set(sides.flatMap((s) => [...s.units.keys()]))];
  const order = (k) => { const u = sides[0].units.get(k) || sides[1].units.get(k); return [TYPES.indexOf(u.type), u.svc.toLowerCase(), ["service", "endpoint", "object", "mappingsets", "model", "provider", "manifest", "operation", "file"].indexOf(u.kind), u.id.toLowerCase()]; };
  keys.sort((x, y) => { const a = order(x), b = order(y); for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1; return 0; });
  const units = [];
  const refs = []; // {from, svc, op}
  onProgress({ done: 0, total: keys.length, running: true });
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i];
    const ua = sides[0].units.get(k), ub = sides[1].units.get(k);
    const u = ua || ub;
    const r = { key: k, type: u.type, svc: u.svc, ver: u.ver, kind: u.kind, id: u.id, present: [!!ua, !!ub], files: [ua ? ua.files : null, ub ? ub.files : null] };
    try {
      const [ta, tb] = [await readTexts(ua), await readTexts(ub)];
      const pa = ta && unitProps(u, ta), pb = tb && unitProps(u, tb);
      // a unit on one side only is reported as added/removed as a whole - no per-property list
      r.changes = pa && pb ? diffProps(u, pa, pb) : [];
      r.counts = { logic: 0, environment: 0, format: 0 };
      for (const c of r.changes) r.counts[c.cat]++;
      r.props = [pa ? pa.size : 0, pb ? pb.size : 0];
      r.status = !ua ? "onlyB" : !ub ? "onlyA" : r.counts.logic ? "changed" : r.counts.environment ? "environment" : r.counts.format ? "format" : "same";
      if (u.kind === "endpoint" || u.kind === "operation" || u.kind === "provider") r.subtype = (pb || pa).get("@type") || (pb || pa).get("type") || "";
      for (const [side, p] of [[0, pa], [1, pb]]) for (const x of refsOf(u, p)) refs.push({ from: k, side, ...x });
    } catch (e) {
      r.error = String(e.message || e);
      r.status = "error";
      r.changes = [];
      r.counts = { logic: 0, environment: 0, format: 0 };
    }
    units.push(r);
    if (i % 25 === 0) { onProgress({ done: i + 1, total: keys.length, running: true }); await new Promise((res) => setTimeout(res)); }
  }
  // resolve references to unit keys (Integration first, then Orchestration)
  const byOp = new Map();
  for (const r of units) if (r.kind === "operation" && (r.type === "Integration" || r.type === "Orchestration")) {
    const k = `${r.svc}::${r.id}`;
    if (!byOp.has(k) || r.type === "Integration") byOp.set(k, r.key);
  }
  const usedBy = {}, uses = {};
  for (const x of refs) {
    const target = byOp.get(`${x.svc}::${x.op}`) || null;
    (uses[x.from] = uses[x.from] || []).push({ side: x.side, svc: x.svc, op: x.op, target });
    if (target) (usedBy[target] = usedBy[target] || []).push({ side: x.side, from: x.from });
  }
  onProgress({ done: keys.length, total: keys.length, running: false });
  return { labels, version, units, usedBy, uses };
}

// re-read one unit for the detail view (property maps are not kept for every unit)
export async function unitDetail(r) {
  const u = { type: r.type, svc: r.svc, ver: r.ver, kind: r.kind, id: r.id };
  const texts = [];
  for (const files of r.files) {
    if (!files) { texts.push(null); continue; }
    const t = {};
    for (const [name, { f }] of Object.entries(files)) t[name] = (await f.text()).replace(/^﻿/, "");
    texts.push(t);
  }
  const props = texts.map((t) => (t ? unitProps(u, t) : null));
  return { texts, props };
}

// mask secret values inside raw file text (XML attributes, JSON values, escaped JSON inside strings)
export function maskText(text) {
  return text
    .replace(/(name="(?:password|[a-z_]*secret[a-z_]*)"\s+value=")([^"]*)(")/gi, (m, a, v, b) => (v ? `${a}••••••${b}` : m))
    .replace(/(<key>(?:password|[a-z_]*secret[a-z_]*)<\/key>\s*<value>)([^<]*)(<\/value>)/gi, (m, a, v, b) => (v ? `${a}••••••${b}` : m))
    .replace(/("(?:password|[a-z_]*secret[a-z_]*|client_pvt_key_jwt)"\s*:\s*")([^"]*)(")/gi, (m, a, v, b) => (v ? `${a}••••••${b}` : m))
    .replace(/(\\"(?:password|[a-z_]*secret[a-z_]*|client_pvt_key_jwt)\\"\s*:\s*\\")((?:[^\\]|\\(?!"))*)(\\")/gi, (m, a, v, b) => (v ? `${a}••••••${b}` : m));
}
