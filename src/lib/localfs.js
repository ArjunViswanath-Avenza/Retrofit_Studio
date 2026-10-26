// Folders opened by path through the local file service (server/files.js). Each file behaves like a picked File for
// the tools — webkitRelativePath, name, text(), arrayBuffer() — but reads go to the service, gathered into batches:
// every text() asked for in the same moment travels in one request.
import { noteRead } from "./perf.js";

let status = null;
export async function serviceStatus(fresh) {
  if (status && !fresh) return status;
  try {
    const r = await fetch("/api/fs/status");
    status = r.ok ? await r.json() : { available: false };
  } catch { status = { available: false }; }
  return status;
}

const BATCH = 400, IN_FLIGHT = 4;
const dec = new TextDecoder();

class Source {
  constructor(id, name, dir) { this.id = id; this.name = name; this.dir = dir; this.queue = []; this.flushing = false; this.active = 0; }
  text(rel) {
    return new Promise((resolve, reject) => {
      this.queue.push({ rel, resolve, reject });
      if (!this.flushing) { this.flushing = true; queueMicrotask(() => { this.flushing = false; this.pump(); }); }
    });
  }
  pump() {
    while (this.queue.length && this.active < IN_FLIGHT) {
      const part = this.queue.splice(0, BATCH);
      this.active++;
      this.send(part).finally(() => { this.active--; this.pump(); });
    }
  }
  async send(part) {
    try {
      const r = await fetch("/api/fs/read", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: this.id, paths: part.map((x) => x.rel) }) });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `read failed (${r.status})`);
      const buf = new Uint8Array(await r.arrayBuffer());
      const view = new DataView(buf.buffer);
      let at = 0;
      for (const x of part) {
        const len = view.getInt32(at, true);
        at += 4;
        if (len < 0) { x.reject(new Error(`cannot read ${x.rel}`)); continue; }
        noteRead(len);
        x.resolve(dec.decode(buf.subarray(at, at + len)));
        at += len;
      }
    } catch (e) { for (const x of part) x.reject(e); }
  }
}

class LocalFile {
  constructor(src, rel, size) {
    this.src = src;
    this.rel = rel;
    this.name = rel.slice(rel.lastIndexOf("/") + 1);
    this.webkitRelativePath = `${src.name}/${rel}`;
    this.size = size || 0;
  }
  get url() { return `/api/fs/raw?id=${this.src.id}&p=${encodeURIComponent(this.rel)}`; }
  text() { return this.src.text(this.rel); }
  async arrayBuffer() {
    const r = await fetch(this.url);
    if (!r.ok) throw new Error(`cannot read ${this.rel}`);
    const b = await r.arrayBuffer();
    noteRead(b.byteLength);
    return b;
  }
}

// list a folder by its full path; skip: folder names never listed
export async function openFolder(dir, skip) {
  const r = await fetch("/api/fs/open", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: dir, skip }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `could not open ${dir}`);
  const src = new Source(j.id, j.name, j.dir);
  return { dir: j.dir, ms: j.ms, files: j.files.map((rel) => new LocalFile(src, rel, j.sizes && j.sizes[rel])) };
}
