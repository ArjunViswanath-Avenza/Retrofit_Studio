// Every tool, grouped into areas, with its menu. Kept free of the tools' own code so the start-up bundle stays small —
// each tool's code loads when it is first opened (App.jsx).
const names3 = (L) => L.join(" · ");

export const AREAS = [
  { id: "projects", ico: "▣", label: "Projects" },
  { id: "compare", ico: "⇄", label: "Compare" },
  { id: "explore", ico: "◎", label: "Explore" },
  { id: "convert", ico: "⇢", label: "Convert" },
];

const uiMenu = (L) => [
  { id: "home", ico: "◧", label: "Project Overview", desc: `Counts across ${names3(L)}` },
  { id: "forms", ico: "▤", label: "FormForge", desc: "Forms retrofit", items: [{ id: "forms", label: "Form comparison" }, { id: "forms-pair", label: "Pair comparison" }, { id: "forms-all", label: "Overall comparison" }] },
  { id: "controllers", ico: "⚙", label: "CtrlSync", desc: "Form-level controllers", items: [{ id: "controllers", label: "Controller comparison" }, { id: "controllers-all", label: "Overall comparison" }] },
  { id: "mvc", ico: "❏", label: "MVC Bridge", desc: "Business & Presentation controllers", items: [{ id: "mvc", label: "Business & Presentation comparison" }, { id: "mvc-all", label: "Overall comparison" }] },
  { id: "comps", ico: "⧉", label: "COMP-are", desc: "User widgets (components)", items: [{ id: "comps", label: "Component comparison" }, { id: "comps-all", label: "Overall comparison" }] },
];
const maMenu = (L) => [
  { id: "home", ico: "❖", label: "Micro-app map", desc: `Where monolith items live in ${L[2]}` },
  ...uiMenu(L).slice(1),
  { id: "segs", ico: "☷", label: "TemplateTwin", desc: "Segment templates", items: [{ id: "segs", label: "Segment comparison" }, { id: "segs-all", label: "Overall comparison" }] },
];
const fabMenu = (L) => [
  { id: "fab-overview", ico: "≋", label: "LoomSync Overview", desc: `All service types · ${names3(L)}` },
  { id: "fab-Integration", ico: "⇄", label: "Integration", desc: "Endpoints & operations" },
  { id: "fab-Object", ico: "◫", label: "Object", desc: "Objects, fields & mappings" },
  { id: "fab-Orchestration", ico: "⛓", label: "Orchestration", desc: "Composite & looping operations" },
  { id: "fab-Identity", ico: "🔑", label: "Identity", desc: "Identity providers" },
  { id: "fab-Workflow", ico: "↯", label: "Workflow", desc: "Workflow services" },
  { id: "fab-App", ico: "▣", label: "App manifest", desc: "Service lists" },
  { id: "jars", ico: "☕", label: "Java JARs", desc: "Decompiled jar comparison" },
];
export const VZ_MENU = [
  { id: "vz-flow", ico: "◎", label: "Flow overview", desc: "Modules → micro apps" },
  { id: "vz-atlas", ico: "✦", label: "Form atlas", desc: "Every form flying to its micro app" },
  { id: "vz-apps", ico: "▦", label: "Micro apps", desc: "What each one will hold" },
  { id: "vz-modules", ico: "☰", label: "Modules & forms", desc: "Every form and its destination" },
  { id: "vz-plan", ico: "✓", label: "Review & agree", desc: "Choices, overrides, sign-off" },
];
export const BP_MENU = [
  { id: "bp-home", ico: "⌗", label: "Project blueprint", desc: "Every module, part by part" },
  { id: "bp-module", ico: "▦", label: "Module", desc: "Forms, controllers, presentation, business" },
  { id: "bp-form", ico: "▤", label: "Form", desc: "Screen, actions, data in & out" },
  { id: "bp-flow", ico: "⇄", label: "Code flow breakdown", desc: "One action to the model and back" },
  { id: "bp-locate", ico: "⌖", label: "Action locator", desc: "Where every action lives, project-wide" },
];
export const OB_MENU = [
  { id: "ob-sky", ico: "✦", label: "Sky", desc: "Galaxies, solar systems, every connection" },
  { id: "ob-catalogue", ico: "☰", label: "Star catalogue", desc: "Every galaxy and system, searchable" },
];
const CV_MENU = [
  { id: "cv-plan", ico: "▦", label: "Conversion plan", desc: "Monolith module → micro app" },
  { id: "cv-run", ico: "⇢", label: "Convert & report", desc: "Write the micro-app projects" },
];

// needs(slots): null when the tool can open, otherwise what is missing
const isKind = (s, k) => s && s.kind === k;
export const TOOLS = {
  ma: {
    area: "compare", ico: "❖", title: "Monolith → micro app", names: "viz", home: "home", menu: maMenu,
    desc: (L) => `${L[0]} and ${L[1]} monoliths against the ${L[2]} micro apps: forms, controllers, MVC, user widgets and segment templates, each located in its micro app first.`,
    needs: (s, L) => (!isKind(s.base, "monolith") || !isKind(s.custom, "monolith") ? `${L[0]} and ${L[1]} monoliths` : !isKind(s.target, "microapps") ? `${L[2]} micro-app folder` : null),
  },
  ui: {
    area: "compare", ico: "▤", title: "Monolith → monolith", names: "viz", home: "home", menu: uiMenu,
    desc: (L) => `Three monoliths — ${names3(L)}: forms, controllers, MVC extensions and user widgets.`,
    needs: (s, L) => (!isKind(s.base, "monolith") || !isKind(s.custom, "monolith") ? `${L[0]} and ${L[1]} monoliths` : null),
  },
  fabric: {
    area: "compare", ico: "≋", title: "Fabric", names: "fabric", home: "fab-overview", menu: fabMenu,
    desc: () => "Exported Fabric apps service by service (LoomSync), plus every Java jar decompiled and compared.",
    needs: (s) => (["fbase", "fcustom", "ftarget"].filter((k) => s[k]).length < 2 ? "two Fabric exports" : null),
  },
  visualize: {
    area: "explore", ico: "◎", title: "Visualize", home: "vz-flow", menu: () => VZ_MENU,
    desc: () => "Where every module and form of a monolith goes in the micro-app architecture — flow, board, review and sign-off.",
    needs: (s) => (Object.values(s).some((x) => isKind(x, "monolith")) ? null : "a monolith"),
  },
  blueprint: {
    area: "explore", ico: "⌗", title: "Blueprint", home: "bp-home", menu: () => BP_MENU,
    desc: () => "One monolith, part by part: modules, forms, every user action and the code flow behind it.",
    needs: (s) => (Object.values(s).some((x) => isKind(x, "monolith")) ? null : "a monolith"),
  },
  observatory: {
    area: "explore", ico: "✦", title: "Observatory", home: "ob-sky", menu: () => OB_MENU,
    desc: () => "A monolith or micro-app project as a sky of galaxies and solar systems, with every connection.",
    needs: (s) => (Object.values(s).some((x) => isKind(x, "monolith") || isKind(x, "microapps")) ? null : "a monolith or micro-app folder"),
  },
  convert: {
    area: "convert", ico: "⇢", title: "Converter", home: "cv-plan", menu: () => CV_MENU,
    desc: () => "Rebuild a monolith as micro-app projects, written straight into a folder you choose.",
    needs: (s, L) => (!Object.values(s).some((x) => isKind(x, "monolith")) ? "a monolith" : !isKind(s.target, "microapps") ? `${L[2]} micro-app folder (reference)` : null),
  },
};
export const TOOL_ORDER = ["ma", "ui", "fabric", "visualize", "blueprint", "observatory", "convert"];
export const toolsOf = (area) => TOOL_ORDER.filter((t) => TOOLS[t].area === area);
