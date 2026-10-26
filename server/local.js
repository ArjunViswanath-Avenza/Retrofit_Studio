// Localhost guard for the dev-server services (files, writer, decompiler). They read and write files on this machine
// and run Java, so they answer only requests made on it. vite.config.js lets tunnel hosts (server.allowedHosts) reach
// the dev server to view the app remotely; a tunnelled request arrives on a loopback socket, so the Host header,
// forwarding headers and the page's Origin are checked as well.
const LOCAL = ["localhost", "127.0.0.1", "::1"];
const hostOf = (h) => String(h || "").replace(/:\d+$/, "").replace(/^\[|\]$/g, "").toLowerCase();

export const isLocal = (req) => {
  const h = req.headers;
  const addr = String((req.socket && req.socket.remoteAddress) || "");
  if (!LOCAL.includes(hostOf(h.host)) || !/^(::1|127\.|::ffff:127\.)/.test(addr)) return false;
  // a proxy or tunnel that rewrites Host to localhost still says where the request came from
  if (h["x-forwarded-for"] || h["x-forwarded-host"] || h.forwarded) return false;
  // a page on another site posting to localhost: browsers send its Origin
  if (h.origin) { try { if (!LOCAL.includes(hostOf(new URL(h.origin).host))) return false; } catch { return false; } }
  return true;
};

// 403 with the { error } body the app's callers show
export const refuse = (res, service) => {
  res.statusCode = 403;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify({ error: `the local ${service} answers only on localhost` }));
};
