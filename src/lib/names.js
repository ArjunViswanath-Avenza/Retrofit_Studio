// Version names per workspace. The comparison logic works by slot role (base / customised / new release);
// names are only what people see, so any naming scheme works (R21 · KBZ · R26, 2021 · Bank · 2026, …).
export const ROLES = {
  base: { label: "Base version", hint: "the original release your customisation started from" },
  custom: { label: "Customised version", hint: "the base plus your own changes" },
  target: { label: "New release", hint: "the version you are moving to" },
};
export const SLOTS = { ui: ["base", "custom", "target"], ma: ["base", "custom", "target"], fabric: ["custom", "target"] };

export const DEFAULT_NAMES = {
  ui: [
    { name: "R21", sub: "Base project · July 2021" },
    { name: "KBZ", sub: "Customised · modified" },
    { name: "R26", sub: "Latest · R26.0.2" },
  ],
  ma: [
    { name: "R21", sub: "Base monolith" },
    { name: "KBZ", sub: "Customised monolith" },
    { name: "R26", sub: "Micro apps" },
  ],
  fabric: [
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
