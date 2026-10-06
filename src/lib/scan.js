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
    if (lp.includes("/userwidgets/")) {
      const c = compPath(p);
      if (c) { if (!comps.has(c.key)) comps.set(c.key, new Map()); comps.get(c.key).set(c.rel, f); }
    }
  }
  return { fileCount: files.length, counts: { forms: forms.size, controllers: controllers.size, business, presentation, components: comps.size }, controllers, forms, mvc, comps };
}

