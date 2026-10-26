// Timings of the heavy steps (reading folders, comparing, background scans) for the ⏱ panel in the top bar.
// File reads are counted by wrapping Blob.text / arrayBuffer once — the count only, nothing else changes.
const runs = [];
const subs = new Set();
let reads = 0, bytes = 0, version = 0;
// listeners hear about changes after the current render (a folder scan can run while a tool is drawing)
let queued = false;
const emit = () => {
  if (queued) return;
  queued = true;
  queueMicrotask(() => { queued = false; version++; for (const f of subs) f(); });
};

export const perfSubscribe = (f) => { subs.add(f); return () => subs.delete(f); };
export const perfVersion = () => version;
export const perfRuns = () => runs;
export const perfTotals = () => ({ reads, bytes });

// reads that do not go through Blob (folders opened through the local file service)
export function noteRead(n) { reads++; bytes += n || 0; }

let installed = false;
export function countReads() {
  if (installed || typeof Blob === "undefined") return;
  installed = true;
  for (const m of ["text", "arrayBuffer"]) {
    const orig = Blob.prototype[m];
    Blob.prototype[m] = function () { reads++; bytes += this.size || 0; return orig.call(this); };
  }
}

// time one step; reads / bytes are what the whole app read while it ran (other steps may overlap)
export async function track(label, fn) {
  const rec = { label, at: new Date(), ms: 0, reads: 0, bytes: 0, running: true, error: null };
  const t0 = performance.now(), r0 = reads, b0 = bytes;
  runs.unshift(rec);
  if (runs.length > 80) runs.length = 80;
  emit();
  const timer = setInterval(() => { rec.ms = performance.now() - t0; rec.reads = reads - r0; rec.bytes = bytes - b0; emit(); }, 1000);
  try {
    return await fn();
  } catch (e) {
    rec.error = e && e.name === "AbortError" ? "stopped" : String((e && e.message) || e);
    throw e;
  } finally {
    clearInterval(timer);
    Object.assign(rec, { ms: performance.now() - t0, reads: reads - r0, bytes: bytes - b0, running: false });
    emit();
  }
}

export function trackSync(label, fn) {
  const t0 = performance.now();
  try { return fn(); } finally {
    runs.unshift({ label, at: new Date(), ms: performance.now() - t0, reads: 0, bytes: 0, running: false, error: null });
    if (runs.length > 80) runs.length = 80;
    emit();
  }
}

export function clearRuns() { runs.length = 0; emit(); }
