// Page addresses: #/<tool>/<page>?item=<key> — Back / Forward and bookmarks work. The loaded folders themselves do not
// survive a reload while they are read in the browser.
import { useEffect, useState, useCallback } from "react";

export function parseHash(h = window.location.hash) {
  const [path, query = ""] = h.replace(/^#\/?/, "").split("?");
  const [tool, nav] = path.split("/").map((s) => { try { return decodeURIComponent(s); } catch { return s; } });
  const item = new URLSearchParams(query).get("item");
  return { tool: tool || "projects", nav: nav || null, item: item || null };
}

export function formatHash({ tool, nav, item }) {
  let h = `#/${encodeURIComponent(tool || "projects")}`;
  if (nav) h += `/${encodeURIComponent(nav)}`;
  if (item) h += `?item=${encodeURIComponent(item)}`;
  return h;
}

export function useRoute() {
  const [route, setRoute] = useState(() => parseHash());
  useEffect(() => {
    const on = () => setRoute(parseHash());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  const go = useCallback((r, { replace } = {}) => {
    const h = formatHash(r);
    if (h === window.location.hash) return;
    if (replace) { window.history.replaceState(null, "", h); setRoute(parseHash(h)); } else window.location.hash = h;
  }, []);
  return [route, go];
}
