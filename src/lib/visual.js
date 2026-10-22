// What the preview renderer needs to draw one version's template: a small project index (files by path inside the
// project + a cached text reader). A monolith is its own project. An R26 template is drawn the way the micro-app
// runtime sees it: its own micro app first, then the shared apps (ResourcesMA holds nearly all skins and images),
// then every other micro app — the first project to have a path wins.
import { loadProject } from "./blueprint.js";

const made = new WeakMap(); // version scan -> Map(app | "" -> index)

function indexOf(lists, ch, name) {
  const files = new Map();
  for (const list of lists) {
    if (!list || !list.length) continue;
    for (const [rel, f] of loadProject(list).files) if (!files.has(rel)) files.set(rel, f);
  }
  const text = new Map();
  const read = async (rel) => {
    if (!text.has(rel)) text.set(rel, (async () => { const f = files.get(rel); return f ? (await f.text()).replace(/^﻿/, "").replace(/\r\n?/g, "\n") : null; })());
    return text.get(rel);
  };
  return { project: { name, files }, ch, read };
}

// p: one version's scan (monolith) or the aligned R26 (segMeta + appFiles); key: "<channel>/<template>"
export function templateIndex(p, key) {
  if (!p || !p.segs || !p.segs.has(key)) return null;
  const ch = key.split("/")[0];
  const meta = p.segMeta && p.segMeta.get(key);
  const app = meta && p.appFiles ? meta.app : "";
  if (!made.has(p)) made.set(p, new Map());
  const cache = made.get(p);
  const id = `${app}|${ch}`;
  if (!cache.has(id)) {
    let lists;
    if (app) {
      const shared = (n) => (n === app ? 0 : /^Resources/.test(n) ? 1 : n === "CommonsMA" ? 2 : n === "OnlineBanking" ? 3 : 4);
      lists = [...p.appFiles.keys()].sort((x, y) => shared(x) - shared(y) || x.localeCompare(y)).map((n) => p.appFiles.get(n));
    } else lists = [p.all];
    cache.set(id, indexOf(lists, ch, app || "monolith"));
  }
  return cache.get(id);
}
