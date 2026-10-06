import { useState, useEffect, useMemo, useRef } from "react";
import { fileStatus, formattedText, diffTexts } from "../lib/filediff";
import { mvcKind } from "../lib/analyzer";
import { roleOf } from "../lib/components";

const DEFAULT_LABELS = ["R21", "KBZ", "R26"];
const PAIRS = [[0, 1], [0, 2], [1, 2]];
const CONTEXT = 3; // lines kept around each change in "Changes only" mode
const CHUNK = 120; // rows per lazily-painted block

const CAT = {
  controllers: {
    title: "Controllers · Overall comparison", noun: "controllers", kind: "js",
    crumb: "Every form-level controller file — formatted (brace style / whitespace only) and compared line by line",
  },
  mvc: {
    title: "Business & Presentation · Overall comparison", noun: "files", kind: "js",
    crumb: "Every Business / Presentation controller file under mvcextensions — formatted and compared line by line",
  },
  forms: {
    title: "Forms · Overall comparison", noun: "forms", kind: "json", grouped: true, unit: "widget files",
    crumb: "Every widget JSON file of every form (.sm folder) — formatted and compared line by line",
  },
  comps: {
    title: "Components · Overall comparison", noun: "components", grouped: true, unit: "files",
    crumb: "Every file of every user widget — controller, actions, uwProperties, uwDependencies, helper scripts and each widget JSON — formatted and compared line by line",
  },
};

// grouped categories: one entry = a folder of files. How each file is typed, titled and ordered.
const kindOf = (cat, id) => (cat === "forms" || /\.json$/i.test(id) ? "json" : /\.js$/i.test(id) ? "js" : "text");
const fileName = (cat, id) => (cat === "forms" ? id + ".json" : id);
const ROLE_RANK = { controller: 0, actions: 1, contract: 2, deps: 3, script: 4, other: 5, structure: 6 };
function sortIds(cat, key, ids) {
  if (cat === "forms") {
    const formId = key.split("/").pop().replace(/\.sm$/i, "");
    return ids.sort((x, y) => (x === formId ? -1 : y === formId ? 1 : x.localeCompare(y)));
  }
  const rank = (id) => ROLE_RANK[roleOf(key, id)] * 2 + (id === "userwidgetmodel.sm/userwidgetmodel.json" ? 0 : 1);
  return ids.sort((x, y) => rank(x) - rank(y) || x.localeCompare(y));
}

const ST_ORDER = ["changed", "onlyA", "onlyB", "fmt", "same"];
const stLabel = (st, la, lb) => ({ changed: "Changed", onlyA: `Only in ${la}`, onlyB: `Only in ${lb}`, fmt: "Formatting only", same: "Identical" })[st];

const titleOf = (cat, key) => {
  if (cat === "comps") return key.split(".").pop();
  const parts = key.split("/");
  if (cat === "forms") return parts.pop().replace(/\.sm$/i, "");
  if (cat === "mvc") return parts[0];
  return parts.pop().replace(/\.js$/i, "");
};
const subOf = (cat, key) => {
  if (cat === "comps") return key.split(".").slice(0, -1).join(".");
  if (cat === "forms") return key.split("/").slice(0, -1).join("/");
  if (cat === "mvc") return key.split("/").slice(1).join("/");
  return key.split("/").slice(0, -1).join("/");
};

// ---- per-pair status scan (hash compare; formats only files whose raw text differs) ----
async function scanPair(cat, picked, ai, bi, onProgress, alive) {
  const kind = CAT[cat].kind;
  const mA = (picked[ai] && picked[ai][cat]) || new Map();
  const mB = (picked[bi] && picked[bi][cat]) || new Map();
  const keys = [...new Set([...mA.keys(), ...mB.keys()])].sort((x, y) => titleOf(cat, x).localeCompare(titleOf(cat, y)) || x.localeCompare(y));
  const status = {}, detail = {};
  for (let i = 0; i < keys.length; i++) {
    if (!alive()) return null;
    const k = keys[i], fa = mA.get(k), fb = mB.get(k);
    if (CAT[cat].grouped) {
      const ids = [...new Set([...(fa ? fa.keys() : []), ...(fb ? fb.keys() : [])])];
      const sts = await Promise.all(ids.map((id) => fileStatus(fa && fa.get(id), fb && fb.get(id), kindOf(cat, id))));
      const counts = { changed: 0, onlyA: 0, onlyB: 0, fmt: 0, same: 0 }, widgets = {};
      ids.forEach((id, n) => { counts[sts[n]]++; widgets[id] = sts[n]; });
      status[k] = !fa ? "onlyB" : !fb ? "onlyA" : counts.changed || counts.onlyA || counts.onlyB ? "changed" : counts.fmt ? "fmt" : "same";
      detail[k] = { counts, widgets };
    } else {
      status[k] = await fileStatus(fa, fb, kind);
    }
    if (i % 8 === 0) { onProgress({ done: i + 1, total: keys.length }); await new Promise((r) => setTimeout(r)); }
  }
  onProgress({ done: keys.length, total: keys.length });
  return { keys, status, detail };
}

// focus: show only that one entry (embedded in a detail page — no title, no list)
export function OverallView({ cat, picked, cache, setCache, focus, labels = DEFAULT_LABELS }) {
  const LABELS = labels;
  const meta = CAT[cat];
  const [pairIdx, setPairIdx] = useState(0);
  const [progress, setProgress] = useState(null);
  const [q, setQ] = useState("");
  const [show, setShow] = useState(new Set(["changed", "onlyA", "onlyB", "fmt"]));
  const [selState, setSel] = useState(null);
  const [listOpenState, setListOpen] = useState(true);
  const sel = focus || selState;
  const listOpen = !focus && listOpenState;
  const [ai, bi] = PAIRS[pairIdx];
  const la = LABELS[ai], lb = LABELS[bi];
  const ck = cat + ":" + pairIdx + ":" + labels.join("|");
  const scan = cache[ck];

  useEffect(() => {
    if (scan) return;
    let alive = true;
    setProgress({ done: 0, total: 0 });
    scanPair(cat, picked, ai, bi, setProgress, () => alive).then((res) => {
      if (alive && res) { setCache((c) => ({ ...c, [ck]: res })); setProgress(null); }
    });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ck, scan]);

  const counts = useMemo(() => {
    const c = { changed: 0, onlyA: 0, onlyB: 0, fmt: 0, same: 0 };
    if (scan) for (const k of scan.keys) c[scan.status[k]]++;
    return c;
  }, [scan]);

  const list = useMemo(() => {
    if (!scan) return [];
    const ql = q.trim().toLowerCase();
    return scan.keys.filter((k) => show.has(scan.status[k]) && (!ql || k.toLowerCase().includes(ql)));
  }, [scan, q, show]);

  useEffect(() => {
    if (scan && (!sel || !scan.status[sel]) && list.length) setSel(list[0]);
  }, [scan, list, sel]);

  const toggle = (st) => setShow((s) => { const n = new Set(s); if (n.has(st)) n.delete(st); else n.add(st); return n; });
  const pairOk = (i) => picked[PAIRS[i][0]] && picked[PAIRS[i][1]];
  const fileOf = (idx, key) => picked[idx] && picked[idx][cat] ? picked[idx][cat].get(key) : undefined;

  return (
    <div>
      {!focus && (
        <>
          <h2 className="page">{meta.title}</h2>
          <div className="crumb">{meta.crumb}</div>
        </>
      )}
      <div className="toolbar">
        <div className="seg">
          {PAIRS.map(([x, y], i) => (
            <button key={i} className={i === pairIdx ? "on" : ""} disabled={!pairOk(i)} onClick={() => setPairIdx(i)}>{LABELS[x]} vs {LABELS[y]}</button>
          ))}
        </div>
        {!focus && <button className="btn ghost" onClick={() => setListOpen((v) => !v)}>{listOpen ? `⟨ Hide ${meta.noun} list` : `☰ Show ${meta.noun} list`}</button>}
        {scan && !focus && (
          <span className="note">
            {scan.keys.length} {meta.noun} · <b>{counts.changed}</b> changed · <b>{counts.onlyA}</b> only in {la} · <b>{counts.onlyB}</b> only in {lb}
            {counts.fmt > 0 && <> · <b>{counts.fmt}</b> formatting only</>} · <b>{counts.same}</b> identical
          </span>
        )}
      </div>

      {!scan ? (
        <div style={{ maxWidth: 520 }}>
          <p className="note">Comparing {la} and {lb} {meta.noun}… {progress ? `${progress.done}/${progress.total}` : ""}</p>
          <div className="progress"><div style={{ width: (progress && progress.total ? (progress.done / progress.total) * 100 : 0) + "%" }} /></div>
        </div>
      ) : (
        <div className={"ovwrap" + (listOpen ? "" : " nolist")}>
          {listOpen && (
            <div className="ovlist">
              <input type="text" placeholder={`Search ${meta.noun}…`} value={q} onChange={(e) => setQ(e.target.value)} />
              <div className="stchips">
                {ST_ORDER.map((st) => (
                  <span key={st} className={"stchip st-" + st + (show.has(st) ? " on" : "")} onClick={() => toggle(st)}>
                    {stLabel(st, la, lb)} <b>{counts[st]}</b>
                  </span>
                ))}
              </div>
              <div className="ovitems">
                {list.map((k) => {
                  const st = scan.status[k], dt = scan.detail[k];
                  return (
                    <div key={k} className={"ovitem" + (k === sel ? " sel" : "")} onClick={() => setSel(k)} title={k}>
                      <div className="ovname">
                        <span className={"stdot st-" + st} />
                        <b>{titleOf(cat, k)}</b>
                        {cat === "mvc" && <span className={"kindpill k-" + mvcKind(k)}>{mvcKind(k)}</span>}
                      </div>
                      <div className="ovsub">
                        {stLabel(st, la, lb)}
                        {dt && st === "changed" && (
                          <> · {cat === "comps" ? "files" : "widgets"} {dt.counts.changed > 0 && <b className="c">~{dt.counts.changed}</b>} {dt.counts.onlyB > 0 && <b className="a">+{dt.counts.onlyB}</b>} {dt.counts.onlyA > 0 && <b className="r">−{dt.counts.onlyA}</b>}</>
                        )}
                      </div>
                      <div className="ovpath">{subOf(cat, k)}</div>
                    </div>
                  );
                })}
                {!list.length && <p className="note">No {meta.noun} match the filters.</p>}
              </div>
            </div>
          )}
          <div className="ovmain">
            {sel && scan.status[sel] ? (
              meta.grouped ? (
                <GroupCompare key={ck + sel} cat={cat} groupKey={sel} ma={fileOf(ai, sel)} mb={fileOf(bi, sel)} detail={scan.detail[sel]} la={la} lb={lb} />
              ) : (
                <FileCompare key={ck + sel} fileKey={sel} fa={fileOf(ai, sel)} fb={fileOf(bi, sel)} la={la} lb={lb} status={scan.status[sel]} />
              )
            ) : (
              <p className="note">{focus ? `Not present in ${la} or ${lb}.` : "Select a file on the left."}</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

const relOf = (f) => (f ? (f.webkitRelativePath || f.name).replace(/\\/g, "/") : null);
// folder path of a grouped entry, from any of its files (strip that file's id from its path)
function folderOf(cat, map) {
  const first = map && map.entries().next().value;
  if (!first) return null;
  const rel = relOf(first[1]), tail = fileName(cat, first[0]);
  return rel.endsWith("/" + tail) ? rel.slice(0, rel.length - tail.length - 1) : rel;
}

function FileCompare({ fileKey, fa, fb, la, lb, status }) {
  const [res, setRes] = useState(null);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [a, b] = await Promise.all([fa ? formattedText(fa) : null, fb ? formattedText(fb) : null]);
        await new Promise((r) => setTimeout(r));
        const d = diffTexts(a, b);
        if (alive) setRes({ sections: [{ id: fileKey, d }] });
      } catch (e) {
        if (alive) setRes({ error: String(e.message || e) });
      }
    })();
    return () => { alive = false; };
  }, [fileKey, fa, fb]);
  return (
    <div>
      <div className="ovhead">
        <div className="ovtitle">{fileKey}</div>
        <span className={"stbadge st-" + status}>{stLabel(status, la, lb)}</span>
      </div>
      {!res ? <p className="note">Formatting and comparing…</p>
        : res.error ? <p className="note">Could not compare: {res.error}</p>
          : <DiffPane sections={res.sections} la={la} lb={lb} pathA={relOf(fa)} pathB={relOf(fb)} />}
    </div>
  );
}

// a folder of files (form .sm or component): one section per file that differs
function GroupCompare({ cat, groupKey, ma, mb, detail, la, lb }) {
  const unit = CAT[cat].unit;
  const [showSame, setShowSame] = useState(false);
  const [res, setRes] = useState(null);
  const ids = useMemo(() => sortIds(cat, groupKey, Object.keys(detail.widgets)), [cat, groupKey, detail]);
  const wanted = useMemo(() => ids.filter((id) => showSame || detail.widgets[id] !== "same"), [ids, showSame, detail]);
  const nSame = detail.counts.same;

  useEffect(() => {
    let alive = true;
    setRes(null);
    (async () => {
      try {
        const sections = [];
        for (let i = 0; i < wanted.length; i++) {
          const id = wanted[i], fa = ma && ma.get(id), fb = mb && mb.get(id);
          const kind = kindOf(cat, id);
          const [a, b] = await Promise.all([fa ? formattedText(fa, kind) : null, fb ? formattedText(fb, kind) : null]);
          sections.push({ id, title: fileName(cat, id), status: detail.widgets[id], d: diffTexts(a, b) });
          if (!alive) return;
        }
        if (alive) setRes({ sections });
      } catch (e) {
        if (alive) setRes({ error: String(e.message || e) });
      }
    })();
    return () => { alive = false; };
  }, [wanted, ma, mb, detail]);

  const c = detail.counts;
  return (
    <div>
      <div className="ovhead">
        <div className="ovtitle">{groupKey}</div>
        <span className="note">
          {ids.length} {unit} · <b className="c">~{c.changed}</b> changed · <b className="a">+{c.onlyB}</b> only in {lb} · <b className="r">−{c.onlyA}</b> only in {la}
          {c.fmt > 0 && <> · {c.fmt} formatting only</>} · {nSame} identical
        </span>
        <span className={"chip" + (showSame ? " on" : "")} onClick={() => setShowSame((v) => !v)}>
          {showSame ? "✓ " : ""}show identical {unit} ({nSame})
        </span>
      </div>
      {!res ? <p className="note">Formatting and comparing {wanted.length} {unit}…</p>
        : res.error ? <p className="note">Could not compare: {res.error}</p>
          : !res.sections.length ? <p className="note">All {unit} are identical in {la} and {lb}.</p>
            : <DiffPane sections={res.sections} la={la} lb={lb} pathA={folderOf(cat, ma)} pathB={folderOf(cat, mb)} />}
    </div>
  );
}

// ---- side-by-side renderer ----

// icon-font glyphs (Unicode private-use area) render as blanks — show them as \uXXXX so changes stay visible
const PUA = /[-]/;
function vis(t) {
  if (!PUA.test(t)) return t;
  return t.split(/([-])/).map((p, i) =>
    i % 2 ? <span key={i} className="pua" title="icon-font glyph">{"\\u" + p.charCodeAt(0).toString(16)}</span> : p);
}
const segs = (list, cls) => list.map(([hl, t], i) => (hl ? <mark key={i} className={cls}>{vis(t)}</mark> : <span key={i}>{vis(t)}</span>));

// flatten sections into display items: section headers, rows, and folded runs of unchanged lines
function flatten(sections, mode, open) {
  const items = [];
  const withHeaders = sections.length > 1 || sections.some((s) => s.title);
  sections.forEach((s, si) => {
    const { rows } = s.d;
    const hunkSet = new Set(s.d.hunks);
    if (withHeaders) items.push({ k: "hdr", s, key: "h" + si });
    let keep = null;
    if (mode === "changes") {
      keep = new Uint8Array(rows.length);
      rows.forEach((r, i) => {
        if (r.t !== "same") for (let j = Math.max(0, i - CONTEXT); j <= Math.min(rows.length - 1, i + CONTEXT); j++) keep[j] = 1;
      });
    }
    for (let i = 0; i < rows.length; i++) {
      if (keep && !keep[i]) {
        let j = i;
        while (j < rows.length && !keep[j]) j++;
        const fk = si + ":" + i;
        if (open.has(fk)) for (let x = i; x < j; x++) items.push({ k: "row", s, r: rows[x], key: si + "." + x });
        else items.push({ k: "fold", n: j - i, fk, key: "f" + fk });
        i = j - 1;
        continue;
      }
      items.push({ k: "row", s, r: rows[i], hunk: hunkSet.has(i), key: si + "." + i });
    }
  });
  return items;
}

function renderItem(it, i, setOpen, la, lb) {
  if (it.k === "hdr") {
    const st = it.s.d.stats;
    return (
      <div key={it.key} className="fhdr" data-i={i}>
        <span className={"stdot st-" + it.s.status} /> <b>{it.s.title}</b>
        <span className={"stbadge st-" + it.s.status}>{stLabel(it.s.status, la, lb)}</span>
        <span className="fstat"><b className="a">+{st.added}</b> <b className="r">−{st.removed}</b> <b className="c">~{st.modified}</b></span>
      </div>
    );
  }
  if (it.k === "fold") {
    return (
      <div key={it.key} className="ffold" onClick={() => setOpen((o) => new Set(o).add(it.fk))}>
        ⋯ {it.n} identical line{it.n === 1 ? "" : "s"} — click to expand
      </div>
    );
  }
  const r = it.r, d = it.s.d;
  const lcls = r.t === "same" ? "" : r.a == null ? "gap" : "del";
  const rcls = r.t === "same" ? "" : r.b == null ? "gap" : "add";
  return (
    <div key={it.key} className={"frow" + (it.hunk ? " hunk" : "")} data-i={i}>
      <span className="fln">{r.a != null ? r.a + 1 : ""}</span>
      <span className={"fcode " + lcls}>{r.a == null ? "" : r.t === "mod" ? segs(r.L, "xd") : vis(d.A[r.a])}</span>
      <span className="fln">{r.b != null ? r.b + 1 : ""}</span>
      <span className={"fcode " + rcls}>{r.b == null ? "" : r.t === "mod" ? segs(r.R, "xa") : vis(d.B[r.b])}</span>
    </div>
  );
}

export function DiffPane({ sections, la, lb, pathA, pathB }) {
  const [mode, setMode] = useState("full");
  const [open, setOpen] = useState(() => new Set());
  const [cur, setCur] = useState(-1);
  const box = useRef(null);
  const items = useMemo(() => flatten(sections, mode, open), [sections, mode, open]);
  const hunkPos = useMemo(() => items.reduce((acc, it, i) => (it.hunk ? (acc.push(i), acc) : acc), []), [items]);
  const tot = useMemo(() => sections.reduce((t, s) => {
    const st = s.d.stats;
    return { added: t.added + st.added, removed: t.removed + st.removed, modified: t.modified + st.modified, lines: t.lines + s.d.rows.length, approx: t.approx || s.d.approx };
  }, { added: 0, removed: 0, modified: 0, lines: 0, approx: false }), [sections]);

  const go = (k) => {
    if (!hunkPos.length) return;
    const n = (k + hunkPos.length) % hunkPos.length;
    setCur(n);
    const el = box.current && box.current.querySelector(`[data-i="${hunkPos[n]}"]`);
    if (el) {
      el.scrollIntoView({ block: "center" });
      el.classList.add("flash");
      setTimeout(() => el.classList.remove("flash"), 1200);
    }
  };

  const chunks = [];
  for (let i = 0; i < items.length; i += CHUNK) chunks.push(i);

  return (
    <div>
      <div className="fbar">
        <div className="seg">
          <button className={mode === "full" ? "on" : ""} onClick={() => setMode("full")}>Full file</button>
          <button className={mode === "changes" ? "on" : ""} onClick={() => { setMode("changes"); setOpen(new Set()); }}>Changes only</button>
        </div>
        <button className="btn ghost" onClick={() => go(cur - 1)} disabled={!hunkPos.length}>◀ Prev change</button>
        <button className="btn ghost" onClick={() => go(cur + 1)} disabled={!hunkPos.length}>Next change ▶</button>
        <span className="note">
          {hunkPos.length ? `${cur >= 0 ? cur + 1 : "–"} / ${hunkPos.length} change blocks` : "No differences"} ·{" "}
          <b className="r">−{tot.removed}</b> removed · <b className="a">+{tot.added}</b> added · <b className="c">~{tot.modified}</b> modified lines
        </span>
        <span className="spacer" />
        <span className="legend">
          <span className="lg-del">removed</span> <span className="lg-add">added</span> <mark className="xd">chars removed</mark> <mark className="xa">chars added</mark>
        </span>
      </div>
      {tot.approx && <p className="note">⚠ Very large difference — the line alignment hit the time limit, so it is correct but may not be the shortest possible.</p>}
      <div className="fdiff" ref={box}>
        <div className="fcols">
          <span className="fcolh" title={pathA || ""}>{la}{pathA ? " · " + pathA : " · (not present)"}</span>
          <span className="fcolh" title={pathB || ""}>{lb}{pathB ? " · " + pathB : " · (not present)"}</span>
        </div>
        {chunks.map((start) => (
          <div className="fchunk" key={start + ":" + mode} style={{ containIntrinsicSize: `auto ${Math.min(CHUNK, items.length - start) * 19}px` }}>
            {items.slice(start, start + CHUNK).map((it, j) => renderItem(it, start + j, setOpen, la, lb))}
          </div>
        ))}
      </div>
    </div>
  );
}
