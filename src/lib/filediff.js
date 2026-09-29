// Full-file side-by-side comparison (Overall comparison views).
// Files are formatted with the same js-beautify rules as everywhere else (whitespace / brace style only),
// diffed line-by-line with Myers (diff-match-patch, linear space — the O(n·m) lcsDiff can't take 20k-line files),
// and each changed line that pairs with a similar line on the other side gets character-level highlights.
import DiffMatchPatch from "diff-match-patch";
import { fmt } from "./analyzer.js";

const dmp = new DiffMatchPatch();
const LINE_TIMEOUT = 10; // seconds; past this Myers returns a valid but possibly non-minimal diff (flagged)
const PAIR_MIN_SIM = 0.45; // bigram similarity needed to treat a removed + added line as one modified line
const ALIGN_MAX_CELLS = 60000; // hunk size (removed × added) up to which pairing uses the optimal alignment

export const normalize = (s) => (s || "").replace(/\r\n?/g, "\n").replace(/^﻿/, "");

// cyrb53 — fast 53-bit string hash for "is this file identical" checks without keeping every text in memory
export function hash(str) {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return str.length + ":" + (4294967296 * (2097151 & h2) + (h1 >>> 0));
}

// JSON with all whitespace outside string literals removed — equal iff the formatted files are equal
function squashJson(s) {
  let out = "", i = 0; const n = s.length;
  while (i < n) {
    const c = s[i];
    if (c === '"') {
      let j = i + 1;
      while (j < n && s[j] !== '"') j += s[j] === "\\" ? 2 : 1;
      out += s.slice(i, j + 1); i = j + 1; continue;
    }
    if (c !== " " && c !== "\n" && c !== "\t" && c !== "\r") out += c;
    i++;
  }
  return out;
}

// ---- per-File caches: hashes kept for every file, formatted text only for the most recently viewed ones ----
const info = new WeakMap(); // File -> { raw, deep }
const recent = new Map(); // File -> formatted text (small LRU)
const RECENT_MAX = 24;

async function rawText(file) { return normalize(await file.text()); }

export async function formattedText(file) {
  if (recent.has(file)) { const t = recent.get(file); recent.delete(file); recent.set(file, t); return t; }
  const t = fmt(await rawText(file));
  recent.set(file, t);
  if (recent.size > RECENT_MAX) recent.delete(recent.keys().next().value);
  return t;
}

// raw hash always; "deep" hash (formatted JS / squashed JSON) only when asked — i.e. when raw texts differ
async function hashes(file, kind, deep) {
  let h = info.get(file);
  if (!h) { h = { raw: null, deep: null }; info.set(file, h); }
  if (h.raw && (!deep || h.deep)) return h;
  const raw = await rawText(file);
  h.raw = hash(raw);
  if (deep) h.deep = hash(kind === "json" ? squashJson(raw) : await formattedText(file));
  return h;
}

// status of one file across a pair: same | fmt (differs only in formatting) | changed | onlyA | onlyB
export async function fileStatus(fa, fb, kind) {
  if (!fa && !fb) return "none";
  if (!fa) return "onlyB";
  if (!fb) return "onlyA";
  if (fa.size === fb.size) {
    const [a, b] = [await hashes(fa, kind, false), await hashes(fb, kind, false)];
    if (a.raw === b.raw) return "same";
  }
  const [a, b] = [await hashes(fa, kind, true), await hashes(fb, kind, true)];
  if (a.raw === b.raw) return "same";
  return a.deep === b.deep ? "fmt" : "changed";
}

// ---- line diff ----
// Map each distinct line to one UTF-16 code unit (skipping the surrogate block) so Myers runs on lines.
function linesToChars(A, B) {
  const ids = new Map();
  let next = 1;
  const enc = (lines) => {
    let s = "";
    for (const l of lines) {
      let id = ids.get(l);
      if (id === undefined) {
        if (next === 0xd800) next = 0xe000;
        if (next > 0xffff) throw new Error("Too many distinct lines to compare (over 63,000).");
        id = next++; ids.set(l, id);
      }
      s += String.fromCharCode(id);
    }
    return s;
  };
  return [enc(A), enc(B)];
}

// Patience diff over the line-id strings (as git --patience): anchor on lines occurring exactly once on each
// side, keep the longest in-order run of them, recurse between anchors, and use Myers only where no anchor exists.
// Much faster than plain Myers on large files and keeps code blocks together; still an exact diff.
function uniqueAnchors(a, b) {
  const seen = new Map(); // char -> [countA, countB, idxA, idxB]
  for (let i = 0; i < a.length; i++) { const e = seen.get(a[i]); if (e) e[0]++; else seen.set(a[i], [1, 0, i, -1]); }
  for (let j = 0; j < b.length; j++) { const e = seen.get(b[j]); if (e) { e[1]++; e[3] = j; } }
  const cand = [];
  for (const e of seen.values()) if (e[0] === 1 && e[1] === 1) cand.push([e[2], e[3]]);
  cand.sort((x, y) => x[0] - y[0]);
  // longest increasing subsequence on the B index
  const tails = [], prev = new Array(cand.length);
  for (let k = 0; k < cand.length; k++) {
    let lo = 0, hi = tails.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (cand[tails[mid]][1] < cand[k][1]) lo = mid + 1; else hi = mid; }
    prev[k] = lo > 0 ? tails[lo - 1] : -1;
    tails[lo] = k;
  }
  const out = [];
  for (let k = tails.length ? tails[tails.length - 1] : -1; k >= 0; k = prev[k]) out.push(cand[k]);
  return out.reverse();
}

function patience(a, b, out, flags) {
  let p = 0;
  while (p < a.length && p < b.length && a[p] === b[p]) p++;
  let s = 0;
  while (s < a.length - p && s < b.length - p && a[a.length - 1 - s] === b[b.length - 1 - s]) s++;
  if (p) out.push([0, a.slice(0, p)]);
  const ma = a.slice(p, a.length - s), mb = b.slice(p, b.length - s);
  if (!ma.length || !mb.length) {
    if (ma.length) out.push([-1, ma]);
    if (mb.length) out.push([1, mb]);
  } else {
    const anchors = uniqueAnchors(ma, mb);
    if (!anchors.length) {
      const t0 = Date.now();
      for (const d of dmp.diff_main(ma, mb, false)) out.push(d);
      if ((Date.now() - t0) / 1000 >= LINE_TIMEOUT) flags.approx = true;
    } else {
      let x = 0, y = 0;
      for (const [i, j] of anchors) {
        patience(ma.slice(x, i), mb.slice(y, j), out, flags);
        out.push([0, ma[i]]);
        x = i + 1; y = j + 1;
      }
      patience(ma.slice(x), mb.slice(y), out, flags);
    }
  }
  if (s) out.push([0, a.slice(a.length - s)]);
}

function bigrams(s) {
  s = s.trim();
  const m = new Map();
  for (let i = 0; i < s.length - 1; i++) { const g = s.substr(i, 2); m.set(g, (m.get(g) || 0) + 1); }
  return m;
}
function similarity(a, b, ga, gb) {
  const ta = a.trim(), tb = b.trim();
  if (ta === tb) return 1;
  if (ta.length < 2 || tb.length < 2) return 0;
  let inter = 0, na = 0, nb = 0;
  for (const v of ga.values()) na += v;
  for (const v of gb.values()) nb += v;
  for (const [g, v] of ga) { const w = gb.get(g); if (w) inter += Math.min(v, w); }
  return (2 * inter) / (na + nb);
}

// character-level segments for one modified line: left keeps equal + removed, right keeps equal + added
function charSegments(a, b) {
  const d = dmp.diff_main(a, b, false);
  dmp.diff_cleanupSemantic(d);
  const L = [], R = [];
  for (const [op, t] of d) {
    if (op === 0) { L.push([0, t]); R.push([0, t]); }
    else if (op < 0) L.push([1, t]);
    else R.push([1, t]);
  }
  return { L, R };
}

// Lay out one hunk (consecutive removed lines ai[] vs added lines bi[]).
// Similar lines are paired as "mod" rows with character highlights; the rest sit side by side as whole-line changes.
function layoutHunk(ai, bi, A, B, rows) {
  const n = ai.length, m = bi.length;
  const push = (i, j) => rows.push({ t: i != null && j != null ? "chg" : i != null ? "del" : "add", a: i, b: j });
  const zip = (xs, ys) => { for (let k = 0; k < Math.max(xs.length, ys.length); k++) push(k < xs.length ? xs[k] : null, k < ys.length ? ys[k] : null); };
  if (!n || !m) { zip(ai, bi); return; }
  const ga = ai.map((i) => bigrams(A[i])), gb = bi.map((j) => bigrams(B[j]));
  const sim = (x, y) => similarity(A[ai[x]], B[bi[y]], ga[x], gb[y]);
  const pairs = [];
  if (n * m <= ALIGN_MAX_CELLS) {
    // weighted LCS: maximise total similarity of order-preserving pairs above the threshold
    const S = Array.from({ length: n }, (_, x) => Float32Array.from({ length: m }, (_, y) => sim(x, y)));
    const best = Array.from({ length: n + 1 }, () => new Float32Array(m + 1));
    for (let x = n - 1; x >= 0; x--)
      for (let y = m - 1; y >= 0; y--) {
        const take = S[x][y] >= PAIR_MIN_SIM ? S[x][y] + best[x + 1][y + 1] : -1;
        best[x][y] = Math.max(best[x + 1][y], best[x][y + 1], take);
      }
    let x = 0, y = 0;
    while (x < n && y < m) {
      if (S[x][y] >= PAIR_MIN_SIM && best[x][y] === S[x][y] + best[x + 1][y + 1]) { pairs.push([x, y]); x++; y++; }
      else if (best[x][y] === best[x + 1][y]) x++;
      else y++;
    }
  } else {
    for (let k = 0; k < Math.min(n, m); k++) if (sim(k, k) >= PAIR_MIN_SIM) pairs.push([k, k]);
  }
  let x = 0, y = 0;
  for (const [px, py] of pairs) {
    zip(ai.slice(x, px), bi.slice(y, py));
    const r = { t: "mod", a: ai[px], b: bi[py] };
    Object.assign(r, charSegments(A[ai[px]], B[bi[py]]));
    rows.push(r);
    x = px + 1; y = py + 1;
  }
  zip(ai.slice(x), bi.slice(y));
}

// Side-by-side rows for two texts. Row: { t: same|mod|chg|del|add, a: lineIdx|null, b: lineIdx|null, L?, R? }
//   mod = similar lines paired (character highlights) · chg = unrelated lines side by side · del/add = one side only
export function diffTexts(aText, bText) {
  const A = aText == null ? [] : aText.split("\n");
  const B = bText == null ? [] : bText.split("\n");
  const [ca, cb] = linesToChars(A, B);
  const d = [], flags = { approx: false };
  dmp.Diff_Timeout = LINE_TIMEOUT;
  patience(ca, cb, d, flags);
  dmp.Diff_Timeout = 1;
  const approx = flags.approx;
  const rows = [];
  let ia = 0, ib = 0, del = [], add = [];
  const flush = () => { if (del.length || add.length) layoutHunk(del, add, A, B, rows); del = []; add = []; };
  for (const [op, s] of d) {
    for (let k = 0; k < s.length; k++) {
      if (op === 0) { flush(); rows.push({ t: "same", a: ia++, b: ib++ }); }
      else if (op < 0) del.push(ia++);
      else add.push(ib++);
    }
  }
  flush();
  // stats + change-block starts (for prev/next navigation)
  const stats = { removed: 0, added: 0, modified: 0, same: 0 };
  const hunks = [];
  rows.forEach((r, i) => {
    if (r.t === "same") stats.same++;
    else {
      if (r.t === "mod") stats.modified++;
      else { if (r.a != null) stats.removed++; if (r.b != null) stats.added++; }
      if (i === 0 || rows[i - 1].t === "same") hunks.push(i);
    }
  });
  return { A, B, rows, stats, hunks, approx };
}
