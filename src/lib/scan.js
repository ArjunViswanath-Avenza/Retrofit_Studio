// Scan a picked Visualizer project folder (FileList) — groups file references, reads nothing.
import { isMainController, controllerKey, isMvcController, mvcKey } from "./analyzer.js";
import { compPath } from "./components.js";

export function scanFolder(fileList) {
  const files = [...fileList];
  const rel = (f) => (f.webkitRelativePath || f.name).replace(/\\/g, "/");
  const forms = new Map(); // formKey (path under forms/, ending ".sm") -> Map(widgetId -> File)
  let business = 0, presentation = 0;
  const controllers = new Map();
  const mvc = new Map(); // <Module>/<Business|Presentation>Controllers/*.js -> File
  const comps = new Map(); // userwidgets/<component> -> Map(path inside the component folder -> File)
  const segs = new Map(); // "<channel>/<template>" (templates/<channel>/segments/<template>.sm) -> Map(widgetId -> File)
  const tplCtrl = new Map(); // "<channel>/<rootFlex>Controller" (controllers/<channel>/<rootFlex>Controller/) -> Map(file name -> File)
  for (const f of files) {
    const p = rel(f), lp = p.toLowerCase();
    const fi = lp.indexOf("/forms/");
    if (fi >= 0 && lp.endsWith(".json")) {
      const m = p.slice(fi + 7).match(/^(.*?\.sm)\/([^/]+)\.json$/i);
      if (m) {
        if (!forms.has(m[1])) forms.set(m[1], new Map());
        forms.get(m[1]).set(m[2], f);
      }
    }
    if (lp.includes("/mvcextensions/") && lp.endsWith(".js")) {
      if (lp.includes("/businesscontrollers/")) business++;
      else if (lp.includes("/presentationcontrollers/")) presentation++;
      if (isMvcController(p)) mvc.set(mvcKey(p), f);
    }
    if (lp.includes("/controllers/") && isMainController(f.name)) controllers.set(controllerKey(p), f);
    // segment templates; their controller is named after the template's root flex and sits directly under the channel
    const ti = lp.lastIndexOf("/templates/");
    if (ti >= 0 && lp.endsWith(".json")) {
      const m = p.slice(ti + 11).match(/^([^/]+)\/segments\/([^/]+)\.sm\/([^/]+)\.json$/i);
      if (m) { const k = `${m[1]}/${m[2]}`; if (!segs.has(k)) segs.set(k, new Map()); segs.get(k).set(m[3], f); }
    }
    if (lp.includes("/controllers/") && lp.endsWith(".js")) {
      const s = controllerKey(p).split("/");
      if (s.length === 3 && /Controller$/.test(s[1])) { const k = `${s[0]}/${s[1]}`; if (!tplCtrl.has(k)) tplCtrl.set(k, new Map()); tplCtrl.get(k).set(s[2], f); }
    }
    if (lp.includes("/userwidgets/")) {
      const c = compPath(p);
      if (c) { if (!comps.has(c.key)) comps.set(c.key, new Map()); comps.get(c.key).set(c.rel, f); }
    }
  }
  // all: the picked files themselves (references only) — the visual comparison draws templates from them
  return { all: files, fileCount: files.length, counts: { forms: forms.size, controllers: controllers.size, business, presentation, components: comps.size, segments: segs.size }, controllers, forms, mvc, comps, segs, tplCtrl };
}

