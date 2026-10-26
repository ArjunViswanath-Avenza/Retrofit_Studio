// Version names: one set for the Visualizer projects (every compare / explore / convert tool) and one for the Fabric
// exports. The comparison logic works by slot role (base / customised / new release); names are only what people see,
// so any naming scheme works (R21 · KBZ · R26, 2021 · Bank · 2026, …).
export const ROLES = {
  base: { label: "Base version", hint: "the original release your customisation started from" },
  custom: { label: "Customised version", hint: "the base plus your own changes" },
  target: { label: "New release", hint: "the version you are moving to" },
};
export const SLOTS = { viz: ["base", "custom", "target"], fabric: ["base", "custom", "target"] };

export const DEFAULT_NAMES = {
  viz: [
    { name: "R21", sub: "Base version" },
    { name: "KBZ", sub: "Customised" },
    { name: "R26", sub: "New release" },
  ],
  fabric: [
    { name: "R21", sub: "Base Fabric app" },
    { name: "KBZ", sub: "Customised Fabric app" },
    { name: "R26", sub: "New release Fabric app" },
  ],
};

const KEY = "retrofit-studio:version-names";
export function loadNames() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || "null");
    if (!saved) return DEFAULT_NAMES;
    const out = {};
    // earlier versions kept separate names per workspace: the micro-app workspace's names carry over
    if (!saved.viz) saved.viz = saved.ma || saved.ui;
    for (const ws of Object.keys(DEFAULT_NAMES)) {
      const s = saved[ws];
      out[ws] = Array.isArray(s) && s.length === DEFAULT_NAMES[ws].length && !validate(s) ? s : DEFAULT_NAMES[ws];
    }
    return out;
  } catch {
    return DEFAULT_NAMES;
  }
}
export function saveNames(names) {
  try { localStorage.setItem(KEY, JSON.stringify(names)); } catch { /* storage unavailable — names last for this session */ }
}

// null when valid, otherwise a message
export function validate(list) {
  const names = list.map((x) => (x.name || "").trim());
  if (names.some((n) => !n)) return "Every version needs a name.";
  if (names.some((n) => n.length > 24)) return "Keep names to 24 characters or fewer.";
  const lower = names.map((n) => n.toLowerCase());
  if (new Set(lower).size !== lower.length) return "Each version needs a different name.";
  return null;
}
export const clean = (list) => list.map((x) => ({ name: x.name.trim(), sub: (x.sub || "").trim() }));
