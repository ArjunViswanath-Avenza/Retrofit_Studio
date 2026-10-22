// Blueprint: one monolith Visualizer project, read as modules -> forms / controllers / presentation / business,
// and every user action traced through the code with a real JS parser: action -> controller function ->
// presentation function -> business function -> model / service, and the callbacks back to the form's widgets.
// Nothing is guessed: a call whose target is not written literally in the code is shown as "not resolved".
import { parse } from "acorn";

export const EXCLUDED_DIRS = [".git", "node_modules", "jssrc", "binaries", "build", "temp", "ssm_temp", "__appextensions__"];
export const LIFECYCLE = ["init", "preShow", "postShow", "onNavigate", "onBreakpointChange", "onDeviceBack", "willUpdateUI"];
const REPO_VERBS = new Set(["customVerb", "getAll", "getByCriteria", "getByPrimaryKey", "create", "update", "partialUpdate", "remove", "save", "fetch"]);
const IDENTITY_OPS = new Set(["login", "logout", "getProfile", "getBackendToken", "getUserAttributes", "getSecurityAttributes"]);

/* ================================================================ project + index */
export function loadProject(fileList) {
  const all = [...fileList].map((f) => ({ p: (f.webkitRelativePath || f.name).replace(/\\/g, "/"), f }));
  let root = null;
  for (const { p } of all) if (/(^|\/)projectProperties\.json$/.test(p)) {
    const dir = p.slice(0, p.length - "projectProperties.json".length);
    if (root == null || dir.split("/").length < root.split("/").length) root = dir;
  }
  if (root == null) root = all.length ? all[0].p.split("/")[0] + "/" : "";
  const files = new Map(), excluded = {};
  for (const { p, f } of all) {
    if (!p.startsWith(root)) continue;
    const rel = p.slice(root.length);
    const ex = rel.split("/").slice(0, -1).find((d) => EXCLUDED_DIRS.includes(d));
    if (ex) { excluded[ex] = (excluded[ex] || 0) + 1; continue; }
    files.set(rel, f);
  }
  const channels = {};
  for (const rel of files.keys()) { const s = rel.split("/"); if (s[0] === "forms" && s.length > 3 && /\.sm$/.test(s[s.length - 2])) channels[s[1]] = (channels[s[1]] || new Set()).add(s[s.length - 2]); }
  return { name: root.replace(/\/$/, "").split("/").pop() || "project", files, excluded, hasProps: files.has("projectProperties.json"),
    channels: Object.fromEntries(Object.entries(channels).map(([k, v]) => [k, v.size])) };
}

// ModuleConfig files are not always strict JSON (trailing commas, comments)
export function looseJson(text) {
  const t = (text || "").replace(/^﻿/, "");
  try { return JSON.parse(t); } catch { /* fall through */ }
  try { return JSON.parse(t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'])\/\/[^\n]*/g, "$1").replace(/,(\s*[}\]])/g, "$1")); } catch { return undefined; }
}

export async function buildIndex(project, ch) {
  const F = project.files;
  const text = new Map();
  const read = async (rel) => { if (!text.has(rel)) { const f = F.get(rel); text.set(rel, f ? (await f.text()).replace(/^﻿/, "").replace(/\r\n?/g, "\n") : null); } return text.get(rel); };
  const modules = new Map(), forms = new Map(), controllers = new Map();
  const mod = (name) => { if (!modules.has(name)) modules.set(name, { name, forms: [], controllers: [], pcFiles: [], bcFiles: [], otherMvc: [], config: null, configError: null }); return modules.get(name); };
  for (const rel of F.keys()) {
    const s = rel.split("/");
    if (s[0] === "forms" && s[1] === ch) {
      const i = s.findIndex((x) => /\.sm$/.test(x));
      if (i >= 3 || i === 2) {
        const m = s.slice(2, i).join("/") || "(no module)", name = s[i].slice(0, -3);
        const key = m + "/" + name;
        if (!forms.has(key)) { forms.set(key, { key, name, module: m, dir: s.slice(0, i + 1).join("/"), files: [] }); mod(m).forms.push(key); }
        forms.get(key).files.push(rel);
      }
    } else if (s[0] === "controllers" && s[1] === ch && /\.js$/.test(rel)) {
      const i = s.findIndex((x, k) => k >= 2 && k < s.length - 1 && /Controller$/.test(x));
      if (i > 0) {
        const m = s.slice(2, i).join("/") || "(no module)", cname = s[i], key = m + "/" + cname;
        if (!controllers.has(key)) { controllers.set(key, { key, name: cname, form: cname.replace(/Controller$/, ""), module: m, files: [] }); mod(m).controllers.push(key); }
        controllers.get(key).files.push(rel);
      }
    } else if (s[0] === "mvcextensions" && s.length >= 3) {
      const M = mod(s[1]);
      if (s[2] === "PresentationControllers" && /\.js$/.test(rel)) M.pcFiles.push(rel);
      else if (s[2] === "BusinessControllers" && /\.js$/.test(rel)) M.bcFiles.push(rel);
      else if (s[2] === "Config" && /ModuleConfig\.json$/.test(rel)) M.configRel = rel;
      else M.otherMvc.push(rel);
    }
  }
  for (const M of modules.values()) {
    if (!M.configRel) continue;
    const c = looseJson(await read(M.configRel));
    if (c === undefined) M.configError = "ModuleConfig.json could not be read as JSON"; else M.config = c;
  }
  // friendly form names registered in ModuleConfig, per channel key
  const friendly = new Map();
  for (const M of modules.values()) for (const [ck, fs] of Object.entries((M.config && M.config.Forms) || {})) for (const [fn, fc] of Object.entries(fs || {})) {
    if (!fc) continue;
    friendly.set(fc.friendlyName || fn, { module: M.name, channelKey: ck, formName: fc.FormName, controller: fc.Controller, ext: fc.ControllerExtensions || [] });
  }
  const formsByName = new Map();
  for (const f of forms.values()) { if (!formsByName.has(f.name)) formsByName.set(f.name, []); formsByName.get(f.name).push(f.key); }
  const ctrlByForm = new Map();
  for (const c of controllers.values()) { if (!ctrlByForm.has(c.form)) ctrlByForm.set(c.form, []); ctrlByForm.get(c.form).push(c.key); }
  // getXManager() -> module, from ApplicationManager.js
  const managers = {};
  const am = [...F.keys()].find((r) => /^modules\/(require\/)?ApplicationManager\.js$/.test(r));
  if (am) {
    const t = await read(am);
    const re = /prototype\.get(\w+)\s*=\s*function\s*\([^)]*\)\s*\{[^}]*?getModule\(\s*["'](\w+)["']/g;
    let m; while ((m = re.exec(t))) managers[m[1]] = m[2];
  }
  const models = {};
  for (const rel of F.keys()) { const s = rel.split("/"); if (s[0] === "models" && s.length >= 4) (models[s[2]] ||= new Set()).add(s[1]); }
  for (const k in models) models[k] = [...models[k]].sort();
  // methods the project adds to every controller through a prototype (modules/konymvcextns.js: MDAFormController.prototype.x = …)
  // built in: kony.mvc FormController (konyframework.js) and the Infinity MDAFormController extension, which micro-apps
  // inherit from the base app without carrying the file
  const protoFns = new Map([
    ...["destroy", "getCurrentForm", "getCurrentFormFriendlyName", "getPreviousForm", "getPreviousFormFriendlyName", "pauseNavigation", "resumeNavigation", "show"].map((n) => [n, { owner: "kony.mvc.FormController", rel: "konyframework.js (built in)", line: 1 }]),
    ...["attachToModule", "didUpdateUI", "raiseEvent", "shouldUpdateUI", "updateUI", "willUpdateUI"].map((n) => [n, { owner: "MDAFormController", rel: "konymvcextns.js (base app)", line: 1 }]),
  ]);
  for (const rel of F.keys()) {
    if (!/^modules\/.*\.js$/.test(rel)) continue;
    const t = await read(rel);
    if (!t || !t.includes(".prototype.")) continue;
    for (const m of t.matchAll(/\b(\w*Controller)\.prototype\.(\w+)\s*=/g)) if (!protoFns.has(m[2]) || / \((built in|base app)\)$/.test(protoFns.get(m[2]).rel)) protoFns.set(m[2], { owner: m[1], rel, line: t.slice(0, m.index).split("\n").length });
  }
  return { project, ch, modules, forms, controllers, friendly, formsByName, ctrlByForm, managers, models, read, protoFns, classes: new Map(), comps: null, i18n: undefined };
}

/* ================================================================ classes (controller / presentation / business) */
const FUNC = new Set(["FunctionExpression", "ArrowFunctionExpression", "FunctionDeclaration"]);
function parseFile(src) {
  return parse(src, { ecmaVersion: "latest", locations: true, allowReturnOutsideFunction: true, allowAwaitOutsideFunction: true, allowHashBang: true });
}
// function-valued members of one file: define({...}), define([..], function(){ return {...} }), X.prototype.m = function
function membersOfAst(ast) {
  const out = [];
  const putObj = (obj) => { for (const p of obj.properties) if (p.type === "Property" && FUNC.has(p.value.type)) { const k = p.key.name ?? p.key.value; if (k != null) out.push([String(k), p.value]); } };
  const walk = (n) => {
    if (!n || typeof n.type !== "string") return;
    if (n.type === "AssignmentExpression" && n.left.type === "MemberExpression" && n.left.object.type === "MemberExpression" && !n.left.object.computed && n.left.object.property.name === "prototype" && FUNC.has(n.right.type)) {
      const k = n.left.property.name ?? n.left.property.value; if (k != null) out.push([String(k), n.right]);
    }
    for (const key in n) { if (key === "loc") continue; const v = n[key]; if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v.type === "string") walk(v); }
  };
  for (const node of ast.body) {
    if (node.type === "ExpressionStatement" && node.expression.type === "CallExpression" && node.expression.callee.name === "define") {
      for (const a of node.expression.arguments) {
        if (a.type === "ObjectExpression") putObj(a);
        if (FUNC.has(a.type) && a.body.type === "BlockStatement") {
          const ret = a.body.body.find((s) => s.type === "ReturnStatement" && s.argument);
          const retName = ret && ret.argument.type === "Identifier" ? ret.argument.name : null;
          for (const st of a.body.body) {
            if (st.type === "ReturnStatement" && st.argument && st.argument.type === "ObjectExpression") putObj(st.argument);
            if (st.type === "VariableDeclaration") for (const d of st.declarations) if (d.id.name === retName && d.init && d.init.type === "ObjectExpression") putObj(d.init);
          }
        }
      }
    }
  }
  walk(ast);
  return out;
}

// names the file assigns `this` to outside any member (e.g. `scope_AuthPresenter = this;` in the constructor)
function thisAliases(ast) {
  const out = new Set();
  const walk = (n, inMember) => {
    if (!n || typeof n.type !== "string") return;
    if (n.type === "AssignmentExpression" && n.left.type === "Identifier" && n.right.type === "ThisExpression" && !inMember) out.add(n.left.name);
    if (n.type === "Property" && FUNC.has(n.value.type)) { walk(n.value, true); return; }
    if (n.type === "AssignmentExpression" && n.left.type === "MemberExpression" && FUNC.has(n.right.type)) { walk(n.right, true); return; }
    for (const k in n) { if (k === "loc") continue; const v = n[k]; if (Array.isArray(v)) v.forEach((x) => walk(x, inMember)); else if (v && typeof v.type === "string") walk(v, inMember); }
  };
  walk(ast, false);
  return out;
}

// files of a class, in load order (later files win for a function they also define, as the framework does)
function classFiles(idx, kind, key) {
  if (kind === "component") {
    // userwidgets/<ns>/modules/require/<name>Controller.js (+ <name>ControllerActions.js, loaded after)
    const name = key.split(".").pop(), dir = `userwidgets/${key}/modules/require/`;
    return [`${dir}${name}Controller.js`, `${dir}${name}ControllerActions.js`].filter((r) => idx.project.files.has(r));
  }
  if (kind === "controller") {
    const c = idx.controllers.get(key);
    if (!c) return [];
    const main = c.files.filter((r) => r.endsWith(`/${c.name}.js`)), actions = c.files.filter((r) => r.endsWith(`/${c.name}Actions.js`));
    const rest = c.files.filter((r) => !main.includes(r) && !actions.includes(r));
    const fr = idx.friendly.get(c.form);
    const ext = (fr ? fr.ext : []).map((e) => [`controllers/${idx.ch}/${e}.js`, `modules/require/${e}.js`, `modules/${e}.js`].find((r) => idx.project.files.has(r))).filter(Boolean);
    return [...main, ...rest, ...actions, ...ext];
  }
  const M = idx.modules.get(key);
  if (!M) return [];
  const conf = M.config || {};
  if (kind === "pc") {
    const P = conf.PresentationControllerConfig || {};
    const p = P[idx.ch === "desktop" ? "Default" : idx.ch] || P.Default || Object.values(P)[0];
    if (p && p.PresentationControllerClass) {
      const list = [p.PresentationControllerClass, ...(p.PresentationExtensions || [])].map((c) => `mvcextensions/${c}.js`).filter((r) => idx.project.files.has(r));
      if (list.length) return list;
    }
    return M.pcFiles;
  }
  const B = conf.BusinessControllerConfig || {};
  if (B.BusinessControllerClass) {
    const list = [B.BusinessControllerClass, ...(B.BusinessExtensions || [])].map((c) => `mvcextensions/${c}.js`).filter((r) => idx.project.files.has(r));
    if (list.length) return list;
  }
  return M.bcFiles;
}

// the cache holds the loading promise, so a second caller waits for the whole class instead of getting it half-read
export function getClass(idx, kind, key) {
  const id = kind + ":" + key;
  if (!idx.classes.has(id)) idx.classes.set(id, loadClass(idx, kind, key, id));
  return idx.classes.get(id);
}
async function loadClass(idx, kind, key, id) {
  const cls = { id, kind, key, members: new Map(), files: [], errors: [], src: new Map(), vars: null, aliases: new Set() };
  for (const rel of classFiles(idx, kind, key)) {
    const src = await idx.read(rel);
    if (src == null) continue;
    cls.files.push(rel); cls.src.set(rel, src.split("\n"));
    let ast;
    try { ast = parseFile(src); } catch (e) { cls.errors.push(`${rel}: ${e.message}`); continue; }
    for (const a of thisAliases(ast)) cls.aliases.add(a);
    for (const [name, node] of membersOfAst(ast)) cls.members.set(name, { name, node, rel, line: node.loc.start.line, end: node.loc.end.line, overrides: cls.members.has(name) ? cls.members.get(name).rel : null });
  }
  if (kind === "controller") { const c = idx.controllers.get(key); cls.module = c && c.module; cls.form = c && c.form; }
  else if (kind === "component") { cls.module = null; cls.ns = key; }
  else cls.module = key;
  return cls;
}
export async function controllerOfForm(idx, formName, module) {
  const keys = idx.ctrlByForm.get(formName) || [];
  const key = keys.find((k) => k.startsWith(module + "/")) || keys[0];
  return key ? getClass(idx, "controller", key) : null;
}

/* ================================================================ one function, read with the parser */
const srcOf = (cls, rel, node) => {
  const L = cls.src.get(rel);
  if (!L) return "";
  const a = node.loc.start, b = node.loc.end;
  if (a.line === b.line) return L[a.line - 1].slice(a.column, b.column);
  return [L[a.line - 1].slice(a.column), ...L.slice(a.line, b.line - 1), L[b.line - 1].slice(0, b.column)].join("\n");
};
const lineOf = (cls, rel, line) => ((cls.src.get(rel) || [])[line - 1] || "").trim();
const strArg = (n) => (n && n.type === "Literal" && typeof n.value === "string" ? n.value : n && n.type === "TemplateLiteral" && !n.expressions.length ? n.quasis[0].value.cooked : null);
const objKeys = (n) => (n && n.type === "ObjectExpression" ? n.properties.filter((p) => p.type === "Property").map((p) => ({ key: String(p.key.name ?? p.key.value), value: strArg(p.value) })) : null);
function chain(n) { // a.b().c("x").d -> segments
  const out = [];
  let cur = n;
  while (cur) {
    if (cur.type === "MemberExpression") { out.unshift({ name: cur.computed ? strArg(cur.property) : cur.property.name }); cur = cur.object; }
    else if (cur.type === "CallExpression") { const c = chain(cur.callee); const last = c.pop(); out.unshift({ call: last ? last.name : null, args: cur.arguments, node: cur }); out.unshift(...c); cur = null; }
    else if (cur.type === "ThisExpression") { out.unshift({ this: true }); cur = null; }
    else if (cur.type === "Identifier") { out.unshift({ id: cur.name }); cur = null; }
    else { out.unshift({ other: cur.type }); cur = null; }
  }
  return out;
}

// variables and helpers of a whole member (closures see them), plus class-level this.x assignments
function collectScope(cls, idx, fnNode) {
  const sc = { aliases: new Set(["this", ...cls.aliases]), vars: new Map(), localFns: new Map(), params: (fnNode.params || []).map((p) => (p.type === "Identifier" ? p.name : p.type === "AssignmentPattern" && p.left.type === "Identifier" ? p.left.name : null)) };
  const visit = (n, top) => {
    if (!n || typeof n.type !== "string") return;
    if (n !== top && n.type === "FunctionDeclaration" && n.id) sc.localFns.set(n.id.name, n);
    if (n.type === "VariableDeclarator" && n.id.type === "Identifier" && n.init) {
      if (n.init.type === "ThisExpression") sc.aliases.add(n.id.name);
      else { const r = recvKind(cls, idx, sc, n.init); if (r) sc.vars.set(n.id.name, r); }
      if (FUNC.has(n.init.type)) sc.localFns.set(n.id.name, n.init);
    }
    if (n.type === "AssignmentExpression" && n.left.type === "Identifier") {
      if (n.right.type === "ThisExpression") sc.aliases.add(n.left.name);
      else { const r = recvKind(cls, idx, sc, n.right); if (r) sc.vars.set(n.left.name, r); }
    }
    for (const k in n) { if (k === "loc") continue; const v = n[k]; if (Array.isArray(v)) v.forEach((x) => visit(x, top)); else if (v && typeof v.type === "string") visit(v, top); }
  };
  visit(fnNode.body, fnNode);
  return sc;
}
function classVars(cls, idx) {
  if (cls.vars) return cls.vars;
  cls.vars = new Map(); cls.helpers = new Map();
  for (const m of cls.members.values()) {
    const sc = { aliases: new Set(["this", ...cls.aliases]), vars: new Map(), localFns: new Map(), params: [] };
    const visit = (n) => {
      if (!n || typeof n.type !== "string") return;
      if (n.type === "AssignmentExpression" && n.left.type === "MemberExpression" && n.left.object.type === "ThisExpression" && !n.left.computed) {
        const r = recvKind(cls, idx, sc, n.right, true); if (r) cls.vars.set(n.left.property.name, r);
      }
      // a helper like loadAuthModule() { return …getModule("AuthModule") }
      if (n.type === "ReturnStatement" && n.argument) { const r = recvKind(cls, idx, sc, n.argument, true); if (r && r.kind === "module") cls.helpers.set(m.name, r); }
      for (const k in n) { if (k === "loc") continue; const v = n[k]; if (Array.isArray(v)) v.forEach(visit); else if (v && typeof v.type === "string") visit(v); }
    };
    visit(m.node.body);
  }
  return cls.vars;
}

// what an expression refers to, when it is one of the framework handles
function recvKind(cls, idx, sc, n, noClassVars) {
  if (!n) return null;
  if (n.type === "ThisExpression" || (n.type === "Identifier" && sc.aliases.has(n.name))) return { kind: "self" };
  if (n.type === "Identifier") return sc.vars.get(n.name) || (n.name === "applicationManager" ? { kind: "appmgr" } : null);
  const c = chain(n);
  if (!c.length) return null;
  const last = c[c.length - 1], prev = c.slice(0, -1);
  if (last.call) {
    const a0 = strArg(last.args[0]);
    if (/^get\w+Manager$/.test(last.call) || last.call === "getPresentationUtility" || /^get\w+Utility$/.test(last.call)) {
      const base = prev.length ? recvKind(cls, idx, sc, last.node.callee.object, noClassVars) : null;
      if (base && base.kind === "appmgr") { const g = last.call.slice(3); return g === "NavigationManager" ? { kind: "navmgr" } : { kind: "bc", module: idx.managers[g] || null, getter: g, how: `applicationManager.${last.call}()` }; }
    }
    if (last.call === "getModule") {
      // micro apps name the app too: getModule({ moduleName: "AuthUIModule", appName: "AuthenticationMA" })
      const ok = last.args[0] && last.args[0].type === "ObjectExpression" ? objKeys(last.args[0]) : [];
      const m = a0 || (ok.find((k) => k.key === "moduleName") || {}).value || null;
      const app = (ok.find((k) => k.key === "appName") || {}).value || null;
      return m ? { kind: "module", module: m, app, how: `getModule("${m}"${app ? `, app ${app}` : ""})` } : { kind: "unknown", why: "module name is not written in the code" };
    }
    if (last.call === "getRepository" || last.call === "getModelDefinition") return a0 ? { kind: "repo", obj: a0, how: `${last.call}("${a0}")` } : { kind: "unknown", why: "object name is not written in the code" };
    if (last.call === "getIntegrationService" || last.call === "getObjectService") return { kind: "service", svc: a0 || "(named at run time)" };
    if (last.call === "getIdentityService") return { kind: "identity" };
    if (last.call === "getController") return a0 ? { kind: "ctrl", form: a0.split("/").pop() } : { kind: "unknown", why: "form name is not written in the code" };
    // this.loadXModule()
    if (prev.length === 1 && (prev[0].this || (prev[0].id && sc.aliases.has(prev[0].id)))) { classVars(cls, idx); const h = cls.helpers && cls.helpers.get(last.call); if (h) return { ...h, how: `this.${last.call}()` }; }
    return null;
  }
  if (last.name === "presentationController" || last.name === "businessController") {
    const base = recvKind(cls, idx, sc, n.object, noClassVars);
    if (base && base.kind === "module") return { kind: last.name === "presentationController" ? "pc" : "bc", module: base.module, app: base.app || null, how: base.how + "." + last.name };
    if (base && base.kind === "self" && last.name === "businessController" && cls.kind !== "controller") return { kind: "bc", module: cls.module, how: "this.businessController" };
    return null;
  }
  if (last.name === "presenter" && prev.length === 1 && recvKind(cls, idx, sc, n.object, noClassVars)?.kind === "self") return { kind: "pc", module: cls.module, how: "this.presenter (the form's own module)" };
  if (last.name === "view" && prev.length === 1 && recvKind(cls, idx, sc, n.object, noClassVars)?.kind === "self") return { kind: "view", path: [] };
  if (prev.length >= 1) {
    const base = recvKind(cls, idx, sc, n.object, noClassVars);
    if (base && base.kind === "view") return { kind: "view", path: [...base.path, last.name] };
    if (base && base.kind === "self" && !noClassVars) { const v = classVars(cls, idx).get(last.name); if (v) return { ...v, how: (v.how || "") + ` (this.${last.name})` }; }
  }
  return null;
}

// conditions a statement sits under, as written
function condText(cls, rel, node) { return srcOf(cls, rel, node).replace(/\s+/g, " ").slice(0, 160); }

// steps of one function, in source order
export function analyzeFn(cls, idx, member, fnNode, outer) {
  const rel = member.rel;
  const memberScope = outer || collectScope(cls, idx, fnNode);
  const own = fnNode === member.node ? memberScope.params : (fnNode.params || []).map((p) => (p.type === "Identifier" ? p.name : null));
  const steps = [];
  const at = (node, conds, extra) => steps.push({ line: node.loc.start.line, code: lineOf(cls, rel, node.loc.start.line), conds: [...conds], ...extra });
  const cbRef = (a) => {
    if (!a) return null;
    let n = a;
    if (n.type === "CallExpression" && n.callee.type === "MemberExpression" && n.callee.property.name === "bind") n = n.callee.object;
    if (n.type === "FunctionExpression" || n.type === "ArrowFunctionExpression") return { inline: n };
    if (n.type === "MemberExpression" && !n.computed) { const r = recvKind(cls, idx, memberScope, n.object); if (r && r.kind === "self" && cls.members.has(n.property.name)) return { member: n.property.name }; }
    if (n.type === "Identifier") {
      if (memberScope.localFns.has(n.name)) return { local: memberScope.localFns.get(n.name), name: n.name };
      const pi = own.indexOf(n.name); if (pi >= 0 && fnNode === member.node) return { param: pi, name: n.name };
      const mi = memberScope.params.indexOf(n.name); if (mi >= 0) return { param: mi, name: n.name };
    }
    return null;
  };
  const callbacks = (args) => args.map((a, i) => { const r = cbRef(a); return r ? { index: i, ...r } : null; }).filter(Boolean);
  const skipFns = new Set();

  const classify = (c, conds) => {
    const callee = c.callee;
    if (c.type === "NewExpression") {
      const ch = chain(callee).map((s) => s.name || s.id).join(".");
      if (/(^|\.)mvc\.Navigation$/.test(ch)) {
        // new kony.mvc.Navigation("frmX") or, in micro apps, ({ appName: "AuthenticationMA", friendlyName: "AuthUIModule/frmLogin" })
        const ok = c.arguments[0] && c.arguments[0].type === "ObjectExpression" ? objKeys(c.arguments[0]) : [];
        const f = strArg(c.arguments[0]) || (ok.find((k) => k.key === "friendlyName") || {}).value || null, app = (ok.find((k) => k.key === "appName") || {}).value || null;
        at(c, conds, { type: "nav", form: f ? f.split("/").pop() : null, app, how: "new kony.mvc.Navigation()" });
      }
      return null;
    }
    if (callee.type === "Identifier") {
      if (memberScope.localFns.has(callee.name)) { at(c, conds, { type: "local", name: callee.name, fn: memberScope.localFns.get(callee.name), callbacks: callbacks(c.arguments) }); return true; }
      const pi = own.indexOf(callee.name);
      if (pi >= 0 && fnNode !== member.node) { at(c, conds, { type: "param", index: pi, name: callee.name, own: true }); return true; }
      const mi = memberScope.params.indexOf(callee.name);
      if (mi >= 0) { at(c, conds, { type: "param", index: mi, name: callee.name }); return true; }
      return null;
    }
    if (callee.type !== "MemberExpression") return null;
    // fn.call(thisArg, a, b) / fn.apply(thisArg, [a, b]) run fn itself
    if (!callee.computed && (callee.property.name === "call" || callee.property.name === "apply") && callee.object.type === "MemberExpression") {
      const args = callee.property.name === "call" ? c.arguments.slice(1) : c.arguments[1] && c.arguments[1].type === "ArrayExpression" ? c.arguments[1].elements : [];
      return classify({ ...c, callee: callee.object, arguments: args, type: "CallExpression" }, conds);
    }
    const prop = callee.computed ? strArg(callee.property) : callee.property.name;
    if (!prop) return null;
    if (prop === "getLocalizedString" && strArg(c.arguments[0])) { at(c, conds, { type: "i18n", key: strArg(c.arguments[0]) }); return true; }
    if (prop === "invoke" || prop === "invokeWithModelDef") {
      const ch = chain(callee.object);
      if (ch.length && ch[ch.length - 1].id === "ModelManager" || (ch[ch.length - 1] && ch[ch.length - 1].name === "ModelManager")) {
        at(c, conds, { type: "service", svcKind: "model", obj: strArg(c.arguments[0]) || "?", verb: strArg(c.arguments[1]) || "?", how: "ModelManager." + prop, callbacks: callbacks(c.arguments) });
        return true;
      }
    }
    const r = recvKind(cls, idx, memberScope, callee.object);
    if (!r) return null;
    const cbs = callbacks(c.arguments);
    switch (r.kind) {
      case "self":
        if (cls.members.has(prop)) { at(c, conds, { type: "self", fn: prop, callbacks: cbs }); return true; }
        if (prop === "presentUserInterface") { const f = strArg(c.arguments[0]); at(c, conds, { type: "present", form: f ? f.split("/").pop() : null, keys: objKeys(c.arguments[1]) }); return true; }
        if (cls.kind === "controller" && idx.protoFns && idx.protoFns.has(prop)) { const pf = idx.protoFns.get(prop); at(c, conds, { type: "framework", what: `this.${prop}()`, owner: pf.owner, rel: pf.rel, defLine: pf.line }); return true; }
        at(c, conds, { type: "unresolved", what: `this.${prop}()`, why: "not a function of this class (framework or inherited)" }); return true;
      case "pc": at(c, conds, { type: "pc", module: r.module, app: r.app || null, fn: prop, how: r.how, callbacks: cbs }); return true;
      case "bc": if (!r.module) { at(c, conds, { type: "unresolved", what: `${r.getter}.${prop}()`, why: `${r.getter} is not listed in ApplicationManager` }); return true; }
        at(c, conds, { type: "bc", module: r.module, app: r.app || null, fn: prop, how: r.how, callbacks: cbs }); return true;
      case "navmgr": {
        const a0 = c.arguments[0], a1 = c.arguments[1];
        if (prop === "navigateTo") {
          const ok = a0 && a0.type === "ObjectExpression" ? objKeys(a0) : [];
          const f = strArg(a0) || (ok.find((k) => k.key === "friendlyName") || {}).value || null, app = (ok.find((k) => k.key === "appName") || {}).value || null;
          at(c, conds, { type: "nav", form: f ? f.split("/").pop() : null, app, formExpr: f ? null : a0 ? srcOf(cls, rel, a0).replace(/\s+/g, " ").slice(0, 80) : "", how: "navigationManager.navigateTo" }); return true;
        }
        if (prop === "updateForm") { at(c, conds, { type: "updateForm", form: strArg(a1) ? strArg(a1).split("/").pop() : null, keys: objKeys(a0), dataText: a0 ? srcOf(cls, rel, a0).replace(/\s+/g, " ").slice(0, 140) : "" }); return true; }
        if (prop === "setCustomInfo" || prop === "getCustomInfo") { at(c, conds, { type: prop === "setCustomInfo" ? "infoSet" : "infoGet", key: strArg(a0) }); return true; }
        at(c, conds, { type: "bc", module: idx.managers.NavigationManager || "NavigationManager", fn: prop, how: "navigation manager", callbacks: cbs }); return true;
      }
      case "repo":
        if (REPO_VERBS.has(prop)) { at(c, conds, { type: "service", svcKind: "model", obj: r.obj, verb: prop === "customVerb" ? strArg(c.arguments[0]) || "?" : prop, how: r.how, callbacks: cbs }); return true; }
        return null;
      case "service": if (prop === "invokeOperation") { at(c, conds, { type: "service", svcKind: "integration", obj: r.svc, verb: strArg(c.arguments[0]) || "?", callbacks: cbs }); return true; } return null;
      case "identity": if (IDENTITY_OPS.has(prop)) { at(c, conds, { type: "service", svcKind: "identity", obj: "Identity service", verb: prop, callbacks: cbs }); return true; } return null;
      case "ctrl": at(c, conds, { type: "ctrl", form: r.form, fn: prop, callbacks: cbs }); return true;
      case "view": at(c, conds, { type: "widget", path: r.path.join("."), action: prop + "()", value: c.arguments.map((a) => srcOf(cls, rel, a).replace(/\s+/g, " ")).join(", ").slice(0, 120) }); return true;
      case "unknown": at(c, conds, { type: "unresolved", what: `.${prop}()`, why: r.why }); return true;
      default: return null;
    }
  };

  const visit = (n, conds) => {
    if (!n || typeof n.type !== "string") return;
    if (n !== fnNode && FUNC.has(n.type)) {
      if (n.type === "FunctionDeclaration" || skipFns.has(n)) return; // local functions run when called; callbacks are traced as callbacks
      return visit(n.body, [...conds, "inside a nested function"]);
    }
    switch (n.type) {
      case "IfStatement": {
        visit(n.test, conds);
        const t = condText(cls, rel, n.test);
        visit(n.consequent, [...conds, `if (${t})`]);
        if (n.alternate) visit(n.alternate, [...conds, `else of if (${t})`]);
        return;
      }
      case "ConditionalExpression": { visit(n.test, conds); const t = condText(cls, rel, n.test); visit(n.consequent, [...conds, `if (${t})`]); visit(n.alternate, [...conds, `else of (${t})`]); return; }
      case "LogicalExpression": { visit(n.left, conds); visit(n.right, [...conds, `${n.operator === "&&" ? "if" : "if not"} (${condText(cls, rel, n.left)})`]); return; }
      case "SwitchStatement": { visit(n.discriminant, conds); const d = condText(cls, rel, n.discriminant); for (const sc of n.cases) for (const s of sc.consequent) visit(s, [...conds, sc.test ? `switch (${d}) case ${condText(cls, rel, sc.test)}` : `switch (${d}) default`]); return; }
      case "TryStatement": { visit(n.block, conds); if (n.handler) visit(n.handler.body, [...conds, "when an error is thrown (catch)"]); if (n.finalizer) visit(n.finalizer, conds); return; }
      case "AssignmentExpression": {
        if (n.left.type === "MemberExpression") {
          const lr = recvKind(cls, idx, memberScope, n.left.object);
          const prop = n.left.computed ? strArg(n.left.property) : n.left.property.name;
          if (lr && lr.kind === "view" && prop) {
            const path = lr.path.join(".");
            // events: onX, form lifecycle, and any function given to a widget property — components raise custom events
            // (this.view.resetPasswordComponent.showLogin = function () {…})
            const fnGiven = !!path && !!cbRef(n.right);
            if (/^on[A-Z]/.test(prop) || /^on[a-z]+$/.test(prop) || (!path && /^(init|preShow|postShow|onHide|onDestroy)$/.test(prop)) || fnGiven) {
              const h = cbRef(n.right);
              at(n, conds, { type: "bind", path, event: prop, handler: h, handlerText: srcOf(cls, rel, n.right).split("\n")[0].slice(0, 100) });
              if (h && h.inline) skipFns.add(h.inline);
            } else at(n, conds, { type: "widget", path, action: prop + " =", value: srcOf(cls, rel, n.right).replace(/\s+/g, " ").slice(0, 80) });
          }
        }
        break;
      }
      case "CallExpression": case "NewExpression": {
        const ok = classify(n, conds);
        if (ok) for (const a of n.arguments) { const r = cbRef(a); if (r && r.inline) skipFns.add(r.inline); }
        break;
      }
      default: break;
    }
    for (const k in n) { if (k === "loc") continue; const v = n[k]; if (Array.isArray(v)) v.forEach((x) => visit(x, conds)); else if (v && typeof v.type === "string") visit(v, conds); }
  };
  visit(fnNode.body, []);
  steps.sort((a, b) => a.line - b.line);
  return { steps, scope: memberScope };
}

/* ================================================================ tracing one entry point */
const MAX_DEPTH = 18, MAX_NODES = 1500;
const layerOf = (cls) => (cls.kind === "controller" || cls.kind === "component" ? "controller" : cls.kind === "pc" ? "presentation" : "business");
export const LAYERS = ["form", "controller", "presentation", "business", "model"];
export const LAYER_LABEL = { form: "Form (screen)", controller: "Form controller", presentation: "Presentation controller", business: "Business controller", model: "Model / service" };

// updateFormUI(context) branches that the sent data can reach: a branch is kept when its condition names one of the
// sent keys (and, for key === "value" tests, the same value), or when it does not depend on the data at all
function keyFilter(keys, conds) {
  if (!keys) return true;
  const cs = conds.filter((c) => c.startsWith("if") || c.startsWith("else") || c.startsWith("switch"));
  if (!cs.length) return true;
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return cs.every((c) => {
    const mentioned = keys.filter((k) => new RegExp(`(?<![\\w$])${esc(k.key)}(?![\\w$])`).test(c));
    if (!mentioned.length) return !/\b(context|viewModel|uiData|data|params|response)\b/.test(c);
    if (c.startsWith("else")) return false;
    for (const k of mentioned) {
      if (k.value == null) continue;
      const m = c.match(new RegExp(`(?<![\\w$])${esc(k.key)}\\s*===?\\s*["']([^"']*)["']`));
      if (m && m[1] !== k.value) return false;
    }
    return true;
  });
}

export async function traceEntry(idx, start) {
  // start: { cls, member, fnNode?, outerScope?, label?, form, module, viewPrefix?, instances?, formEntries? } — the function an action runs
  let count = 0, truncated = false;
  const done = new Map(); // function + callbacks it was given -> first expanded node (later calls refer to it)
  const sig = (b) => [...b.entries()].map(([i, x]) => `${i}=${x.cls.id}#${x.member.name}@${x.fnNode.loc.start.line}`).join(",");
  const mk = async (cls, member, fnNode, bindings, path, depth, outerScope, viaLabel, keys, ctx) => {
    count++;
    const id = cls.id + "#" + member.name + (fnNode !== member.node ? "@" + fnNode.loc.start.line : "");
    const node = { id, uid: count, layer: layerOf(cls), cls: cls.id, clsLabel: clsLabel(cls), name: fnNode === member.node ? member.name : `${member.name} › ${viaLabel || "callback"}`,
      rel: member.rel, line: fnNode.loc.start.line, end: fnNode.loc.end.line, edges: [], keys: keys || null, overrides: member.overrides, screen: ctx.screen, viewPrefix: ctx.prefix || null };
    if (path.has(id)) { node.cycle = true; return node; }
    const dk = id + "|" + sig(bindings) + "|" + (keys ? keys.map((k) => k.key + "=" + k.value).join(",") : "") + "|" + ctx.screen + "|" + (ctx.prefix || "");
    if (done.has(dk)) { node.ref = done.get(dk).uid; node.effect = done.get(dk).effect; return node; }
    if (depth > MAX_DEPTH || count > MAX_NODES) { node.cut = true; truncated = true; return node; }
    done.set(dk, node);
    const p2 = new Set(path).add(id);
    let screen = ctx.screen; // the form on screen as this function runs (changes after it navigates)
    const { steps, scope } = analyzeFn(cls, idx, member, fnNode, outerScope);
    const bindFrom = (cbs) => {
      const b = new Map();
      for (const cb of cbs || []) {
        if (cb.member) b.set(cb.index, { cls, member: cls.members.get(cb.member), fnNode: cls.members.get(cb.member).node, label: cb.member, prefix: ctx.prefix });
        else if (cb.inline) b.set(cb.index, { cls, member, fnNode: cb.inline, outerScope: scope, bindings, label: `inline function (line ${cb.inline.loc.start.line})`, prefix: ctx.prefix });
        else if (cb.local) b.set(cb.index, { cls, member, fnNode: cb.local, outerScope: scope, bindings, label: cb.name, prefix: ctx.prefix });
        else if (cb.param != null && bindings.has(cb.param)) b.set(cb.index, bindings.get(cb.param));
      }
      return b;
    };
    const run = (b, d, keys2) => mk(b.cls, b.member, b.fnNode, b.bindings || new Map(), p2, d, b.outerScope, b.fnNode !== b.member.node ? b.label : null, keys2, { screen, prefix: b.prefix || null });
    for (const s of steps) {
      if (s.type === "i18n" || s.type === "bind" || s.type === "infoGet") continue;
      if (keys && !keyFilter(keys, s.conds)) continue;
      const e = { step: s, kind: s.type };
      const follow = async (tCls, fnName, cbs, pfx) => {
        const m = tCls.members.get(fnName);
        if (!m) { e.missing = `${clsLabel(tCls)} has no function ${fnName}`; return; }
        e.child = await mk(tCls, m, m.node, bindFrom(cbs), p2, depth + 1, null, null, null, { screen, prefix: pfx !== undefined ? pfx : tCls === cls ? ctx.prefix : null });
      };
      if (s.type === "self") await follow(cls, s.fn, s.callbacks);
      else if (s.type === "local") e.child = await mk(cls, member, s.fn, bindings, p2, depth + 1, scope, s.name, null, { screen, prefix: ctx.prefix });
      else if (s.type === "widget") {
        e.path = ctx.prefix ? (s.path ? `${ctx.prefix}.${s.path}` : ctx.prefix) : s.path;
        // this.view.<component instance>.method() runs the component's own code
        const ns = !ctx.prefix && start.instances && start.instances.get(s.path);
        if (ns && /\(\)$/.test(s.action)) {
          const t = await getClass(idx, "component", ns), fn = s.action.slice(0, -2);
          if (t.members.has(fn)) { e.kind = "compCall"; e.comp = s.path; await follow(t, fn, [], s.path); }
        }
      } else if (s.type === "unresolved" && cls.kind === "component" && ctx.prefix && /^this\.(\w+)\(\)$/.test(s.what)) {
        // a component calling one of its events: the form wired a handler to it (<instance>.<event>)
        const ev = s.what.slice(5, -2);
        const h = (start.formEntries || []).find((x) => x.widget === ctx.prefix && x.event === ev && x.member);
        e.kind = "compEvent"; e.event = ev;
        if (h) { e.child = await mk(h.cls, h.member, h.fnNode || h.member.node, new Map(), p2, depth + 1, h.outerScope || null, h.fnNode && h.fnNode !== h.member.node ? h.handlerLabel : null, null, { screen, prefix: h.viewPrefix || null }); e.isReturn = true; }
        else e.noHandler = true;
      }
      else if (s.type === "pc" || s.type === "bc") {
        const t = await getClass(idx, s.type, s.module);
        if (!t.files.length) e.missing = `module ${s.module} has no ${s.type === "pc" ? "presentation" : "business"} controller in this project`;
        else await follow(t, s.fn, s.callbacks);
      } else if (s.type === "ctrl") {
        const t = await controllerOfForm(idx, s.form, "");
        if (!t) e.missing = `no controller found for ${s.form}`; else await follow(t, s.fn, s.callbacks);
      } else if (s.type === "service") {
        e.returns = [];
        const b = bindFrom(s.callbacks);
        for (const [i, x] of b) e.returns.push({ index: i, label: x.label, node: await run(x, depth + 1) });
      } else if (s.type === "param") {
        const b = s.own ? null : bindings.get(s.index);
        if (b) { e.child = await run(b, depth + 1); e.isReturn = true; } else e.toCaller = true;
      } else if (s.type === "nav") { if (s.form) screen = s.form; }
      else if (s.type === "updateForm" || s.type === "present") {
        const formName = s.form || screen;
        e.target = formName; e.targetGuess = !s.form;
        if (formName) {
          const t = await controllerOfForm(idx, formName, start.module || "");
          const fn = s.type === "present" ? "willUpdateUI" : "updateFormUI";
          const m = t && t.members.get(fn);
          if (m) { e.child = await mk(t, m, m.node, new Map(), p2, depth + 1, null, null, s.keys, { screen: formName }); e.isReturn = true; }
          else e.missing = t ? `${formName} controller has no ${fn}` : `no controller found for ${formName}`;
        }
      }
      node.edges.push(e);
    }
    return node;
  };
  const m = start.member;
  const root = await mk(start.cls, m, start.fnNode || m.node, new Map(), new Set(), 0, start.outerScope || null, start.fnNode && start.fnNode !== m.node ? start.label : null, null, { screen: start.form, prefix: start.viewPrefix || null });
  annotate(root);
  return { root, truncated, nodes: count };
}
export const clsLabel = (cls) => (cls.kind === "controller" ? cls.key.split("/").pop() : cls.kind === "component" ? `${cls.key.split(".").pop()} component` : `${cls.key} ${cls.kind === "pc" ? "presentation" : "business"}`);

// does a node lead to data, navigation or the screen? (used to fold helper calls that do nothing visible)
const EFFECT_KINDS = new Set(["service", "nav", "updateForm", "present", "widget", "infoSet", "ctrl", "compEvent", "compCall"]);
function annotate(n, seen = new Map()) {
  if (n.ref) { n.effect = !!seen.get(n.ref); return n.effect; } // the referenced call was expanded earlier in the walk
  n.effect = false;
  for (const e of n.edges) {
    const child = e.child ? annotate(e.child, seen) : false;
    const ret = (e.returns || []).map((r) => (r.node ? annotate(r.node, seen) : false)).some(Boolean);
    e.effect = EFFECT_KINDS.has(e.kind) || child || ret || !!e.isReturn || e.kind === "param";
    if (e.effect) n.effect = true;
  }
  seen.set(n.uid, n.effect);
  return n.effect;
}

/* ================================================================ a form: structure, actions, arrivals */
export async function formWidgets(idx, formKey) {
  const f = idx.forms.get(formKey);
  const W = new Map();
  for (const rel of f.files) if (rel.endsWith(".json")) { const t = await idx.read(rel); const j = looseJson(t); if (j && j.id) W.set(j.id, j); }
  return W;
}
export async function componentIndex(idx) {
  if (idx.comps) return idx.comps;
  const byKuid = new Map();
  const roots = new Map();
  for (const rel of idx.project.files.keys()) { const m = rel.match(/^userwidgets\/([^/]+)\/userwidgetmodel\.sm\/([^/]+)\.json$/); if (m && m[1].split(".").pop() === m[2]) roots.set(m[1], rel); }
  for (const [ns, rel] of roots) { const j = looseJson(await idx.read(rel)); if (j && j.kuid) byKuid.set(j.kuid, ns); }
  idx.comps = byKuid;
  return byKuid;
}
export async function i18nText(idx) {
  if (idx.i18n !== undefined) return idx.i18n;
  const j = looseJson(await idx.read("i18n.json"));
  const L = (j && j.locales) || {};
  const loc = L.en_US || L.en || Object.values(L)[0];
  idx.i18n = (loc && (loc.i18nStrings || loc)) || {};
  return idx.i18n;
}

export async function formActions(idx, formKey) {
  const f = idx.forms.get(formKey);
  const cls = await controllerOfForm(idx, f.name, f.module);
  const W = await formWidgets(idx, formKey);
  const entries = [];
  if (!cls) return { cls: null, entries, W };
  // 1) Visualizer action sequences: the generated <form>ControllerActions.js names event and widget for every AS_ function
  const asRel = cls.files.find((r) => r.endsWith("ControllerActions.js"));
  const widgetOfAs = new Map();
  // events can sit nested: component events under "data", widgets embedded inside another widget's file
  // inside a component instance's "dataDiffs" every key is an inner widget id: its path is <instance>.<inner>
  const walkEv = (o, owner, wType, inDiffs) => {
    for (const [k, v] of Object.entries(o || {})) {
      if (typeof v === "string" && /^AS_/.test(v)) widgetOfAs.set(v, { widget: owner, event: k.replace(/^ide_/, ""), wType });
      else if (v && typeof v === "object" && !Array.isArray(v)) {
        if (k === "dataDiffs") { walkEv(v, owner, wType, true); continue; }
        if (inDiffs) { const root = v.__info__ && v.__info__.isRoot; walkEv(v, root ? owner : `${owner}.${k}`, (v.__info__ && v.__info__.wType) || wType, false); continue; }
        const inner = typeof v.id === "string" ? v.id : v.wType || v["@class"] ? k : null;
        walkEv(v, inner || owner, inner ? v.wType || String(v["@class"] || "").split(".").pop() : wType, false);
      }
    }
  };
  for (const w of W.values()) walkEv(w, w.id, w.wType);
  if (asRel) {
    const L = cls.src.get(asRel) || [];
    for (const m of cls.members.values()) if (m.rel === asRel && /^AS_/.test(m.name)) {
      const cm = (L[m.line - 2] || "").match(/\/\*\*\s*(\w+)\s+defined for\s+(\w+)\s*\*\*\//);
      const j = widgetOfAs.get(m.name);
      const event = j ? j.event : cm ? cm[1] : "event", widget = j ? j.widget : cm ? cm[2] : "?";
      const isForm = j ? j.wType === "Form" : widget === f.name;
      entries.push({ id: "as:" + m.name, group: isForm ? "lifecycle" : "action", source: "Visualizer action sequence", widget, event, label: isForm ? `${event} (form)` : `${widget}.${event}`, cls, member: m, wiredInForm: !!j });
    }
  }
  // 2) onNavigate: the MVC framework calls it on the controller whenever the form is navigated to
  const nav = cls.members.get("onNavigate");
  if (nav) entries.push({ id: "lc:onNavigate", group: "lifecycle", source: "called by the MVC framework on navigation", widget: f.name, event: "onNavigate", label: "onNavigate (form)", cls, member: nav });
  // 3) events set in code: this.view.<widget>.onX = handler, wherever the controller does it
  for (const m of cls.members.values()) {
    if (m.rel === asRel) continue;
    const { steps, scope } = analyzeFn(cls, idx, m, m.node);
    for (const s of steps) if (s.type === "bind") {
      const h = s.handler;
      let target = null, label = s.handlerText;
      if (h && h.member) target = { member: cls.members.get(h.member) };
      else if (h && h.inline) target = { member: m, fnNode: h.inline, outerScope: scope, label: `handler set in ${m.name} (line ${s.line})` };
      else if (h && h.local) target = { member: m, fnNode: h.local, outerScope: scope, label: h.name };
      entries.push({ id: `code:${m.name}:${s.line}:${s.path}.${s.event}`, group: s.path ? "action" : "lifecycle", source: `set in code · ${m.name}() line ${s.line}`, widget: s.path || f.name, event: s.event, label: s.path ? `${s.path}.${s.event}` : `${s.event} (form)`, cls, setIn: m.name, conds: s.conds,
        member: target ? target.member : null, fnNode: target && target.fnNode, outerScope: target && target.outerScope, handlerLabel: target && target.label, unresolved: target ? null : `handler ${label} is not a function of this controller` });
    }
  }
  // 4) components on the form: their own action sequences and the events their controller sets in code
  const comps = await componentIndex(idx);
  const instances = new Map();
  for (const w of W.values()) if (w.wType === "UserWidgetInstance" && w.sourceUserWidget && comps.get(w.sourceUserWidget)) instances.set(w.id, comps.get(w.sourceUserWidget));
  const byNs = new Map();
  for (const [inst, ns] of instances) { if (!byNs.has(ns)) byNs.set(ns, []); byNs.get(ns).push(inst); }
  for (const [ns, insts] of byNs) {
    const cc = await getClass(idx, "component", ns);
    if (!cc.members.size) continue;
    const short = ns.split(".").pop();
    const ca = cc.files.find((r) => r.endsWith("ControllerActions.js"));
    // the component's Visualizer actions are wired in its own widget files
    const CW = new Map();
    for (const rel of idx.project.files.keys()) if (rel.startsWith(`userwidgets/${ns}/userwidgetmodel.sm/`) && rel.endsWith(".json")) { const j = looseJson(await idx.read(rel)); if (j && j.id) CW.set(j.id, j); }
    const asOf = new Map();
    for (const w of CW.values()) for (const [k, v] of Object.entries(w)) if (typeof v === "string" && /^AS_/.test(v)) asOf.set(v, { widget: w.parent ? w.id : "", event: k.replace(/^ide_/, "") });
    for (const m of cc.members.values()) {
      if (m.rel === ca && /^AS_/.test(m.name)) {
        const j = asOf.get(m.name);
        if (!j) continue;
        for (const inst of insts) entries.push({ id: `cas:${inst}:${m.name}`, group: "action", source: `${short} component · Visualizer action sequence`, widget: j.widget ? `${inst}.${j.widget}` : inst, event: j.event, label: `${j.widget ? inst + "." + j.widget : inst}.${j.event}`, cls: cc, member: m, viewPrefix: inst });
        continue;
      }
      const { steps, scope } = analyzeFn(cc, idx, m, m.node);
      for (const st of steps) if (st.type === "bind") {
        const h = st.handler;
        let target = null;
        if (h && h.member) target = { member: cc.members.get(h.member) };
        else if (h && h.inline) target = { member: m, fnNode: h.inline, outerScope: scope, label: `handler set in ${short}.${m.name} (line ${st.line})` };
        else if (h && h.local) target = { member: m, fnNode: h.local, outerScope: scope, label: h.name };
        for (const inst of insts) entries.push({ id: `ccode:${inst}:${m.name}:${st.line}:${st.path}.${st.event}`, group: "action", source: `${short} component code · ${m.name}() line ${st.line}`, widget: st.path ? `${inst}.${st.path}` : inst, event: st.event, label: `${st.path ? inst + "." + st.path : inst}.${st.event}`, cls: cc, setIn: m.name, conds: st.conds,
          member: target ? target.member : null, fnNode: target && target.fnNode, outerScope: target && target.outerScope, handlerLabel: target && target.label, viewPrefix: inst, unresolved: target ? null : `handler ${st.handlerText} is not a function of this component` });
      }
    }
  }
  return { cls, entries, W, instances };
}

// who opens or updates this form: every literal reference in presentation and controller code
export async function formArrivals(idx, formName) {
  const out = [];
  const re = new RegExp(`["'](?:[\\w/]*/)?${formName}["']`);
  const files = [];
  for (const M of idx.modules.values()) for (const r of [...M.pcFiles, ...M.bcFiles]) files.push(["pc", M.name, r]);
  for (const c of idx.controllers.values()) if (c.form !== formName) for (const r of c.files) files.push(["controller", c.key, r]);
  for (const [kind, key, rel] of files) {
    const t = await idx.read(rel);
    if (!t || !re.test(t)) continue;
    const cls = await getClass(idx, kind === "pc" ? (idx.modules.get(key).pcFiles.includes(rel) ? "pc" : "bc") : "controller", key);
    for (const m of cls.members.values()) {
      if (m.rel !== rel) continue;
      const { steps } = analyzeFn(cls, idx, m, m.node);
      const hit = steps.filter((s) => ((s.type === "nav" || s.type === "updateForm" || s.type === "present") && s.form === formName) || (s.type === "ctrl" && s.form === formName) || (s.type === "infoSet" && s.key === formName));
      if (hit.length) out.push({ cls, member: m, how: [...new Set(hit.map((s) => (s.type === "ctrl" ? `calls ${formName}.${s.fn}()` : s.type === "nav" ? "navigates here" : s.type === "infoSet" ? "sets data for it" : "sends data (updateForm)")))], lines: hit.map((s) => s.line) });
    }
  }
  return out;
}
