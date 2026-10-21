// Visualizer skin JSON (themes/<theme>/<skin>.json) -> the CSS the desktop web runtime uses.
// Rules read from a Visualizer desktop web build's own compiled konydesktop.css:
//  colour "RRGGBBAA" (AA = opacity, ff = opaque) · font size = font_size % of 12px, one decimal ·
//  the skin's "desktopweb" block overrides the shared values · enabled custom CSS replaces everything.

export function kColor(c) {
  if (typeof c !== "string" || !/^[0-9a-f]{6}([0-9a-f]{2})?$/i.test(c)) return null;
  const r = parseInt(c.slice(0, 2), 16), g = parseInt(c.slice(2, 4), 16), b = parseInt(c.slice(4, 6), 16);
  const a = c.length === 8 ? parseInt(c.slice(6, 8), 16) / 255 : 1;
  return a >= 1 ? `#${c.slice(0, 6).toLowerCase()}` : `rgba(${r}, ${g}, ${b}, ${Math.round(a * 100) / 100})`;
}
export const fontPx = (size) => Math.round(((Number(size) || 100) * 12) / 100 * 10) / 10;

const CORNERS = [["top_left", "top-left"], ["top_right", "top-right"], ["bottom_right", "bottom-right"], ["bottom_left", "bottom-left"]];

export function skinStyle(json) {
  if (!json) return "";
  const d = { ...json, ...(json.desktopweb && typeof json.desktopweb === "object" ? json.desktopweb : {}) };
  if (d.isCustomCSSEnabled && typeof d.customCSS === "string" && d.customCSS.trim()) return d.customCSS.replace(/\s+/g, " ").trim();
  const out = [];
  // background
  if (d.bg_type === "image" && d.background_image) out.push(`background: url("${d.background_image}") no-repeat`);
  else if ((d.bg_type === "two" || d.bg_type === "ms_gradient") && (d.background_gradient_top_color || d.background_left_color)) {
    const vertical = d.background_style !== "hg";
    const a = kColor(d.background_gradient_top_color || d.background_left_color), b = kColor(d.background_gradient_bottom_color || d.background_right_color);
    if (a && b) out.push(`background: linear-gradient(${vertical ? "to bottom" : "to right"}, ${a}, ${b})`);
  } else if (d.background_color != null) { const c = kColor(d.background_color); if (c) out.push(`background-color: ${c}`); }
  // border
  // per-corner fields (written for desktop web) win over the shared border when they are there
  const corner = d.top_left_border_style != null || d.top_left_border_width != null;
  const bStyle = corner ? d.top_left_border_style || d.border_style : d.border_style;
  if (bStyle && bStyle !== "none") {
    const w = Number(corner && d.top_left_border_width != null ? d.top_left_border_width : d.border_width) || 0;
    const c = kColor(corner && d.top_left_border_color ? d.top_left_border_color : d.border_color) || "transparent";
    out.push(`border: ${w}px solid ${c}`);
    const per = CORNERS.map(([k]) => d[`${k}_border_radius`]);
    const rc = bStyle === "rc" || d.border_style === "rc" || d.border_style === "custom" || CORNERS.some(([k]) => d[`${k}_border_style`] === "rc");
    if (rc && per.some((x) => x != null && x !== "")) out.push(`border-radius: ${per.map((x) => (Number(x) || 0) + "px").join(" ")}`);
    else if (rc && d.border_radius != null) out.push(`border-radius: ${Number(d.border_radius) || 0}px`);
  }
  // shadow
  const sh = d.shadow;
  if (sh && typeof sh === "object" && (sh.x || sh.y || sh.br || sh.nm)) out.push(`box-shadow: ${sh.inner ? "inset " : ""}${sh.x || 0}px ${sh.y || 0}px ${sh.br || 0}px ${sh.nm || 0}px ${kColor(sh.color) || "#000"}`);
  const ts = d.text_shadow;
  if (ts && typeof ts === "object" && (ts.x || ts.y || ts.br)) out.push(`text-shadow: ${ts.x || 0}px ${ts.y || 0}px ${ts.br || 0}px ${kColor(ts.color) || "#000"}`);
  // font
  if (d.font_name || d.font_size != null) {
    const fam = d.font_name && d.font_name !== "None" ? d.font_name : "Helvetica";
    out.push(`font: ${d.font_style || "normal"} ${d.font_weight || "normal"} ${fontPx(d.font_size)}px ${/[ ,]/.test(fam) ? fam : `"${fam}"`}`);
  }
  out.push(`color: ${(d.font_color && kColor(d.font_color)) || "#000000"}`);
  if (d.cursor_type) out.push(`cursor: ${d.cursor_type}`);
  return out.join("; ");
}

// every font a skin uses, so the preview can load it from the project's resources
export function skinFont(json) {
  if (!json) return null;
  const d = { ...json, ...(json.desktopweb && typeof json.desktopweb === "object" ? json.desktopweb : {}) };
  return d.font_name && d.font_name !== "None" ? d.font_name : null;
}
