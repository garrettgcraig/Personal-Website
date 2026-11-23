// Local server for trying the public lands tracker's sync without Netlify: serves the site and
// runs the sync API in memory.
//
//   node tests/lands-dev-server.mjs [--port 8788]
import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { handle } from "../netlify/lib/lands-sync.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const args = process.argv.slice(2);
const port = Number(args[args.indexOf("--port") + 1]) || 8788;
const docs = new Map();
let n = 0;
const store = {
  async get(id) { return docs.get(id) || null; },
  async put(id, doc, etag) {
    const cur = docs.get(id);
    if ((cur ? cur.etag : null) !== etag) return false;
    docs.set(id, { doc, etag: String(++n) });
    return true;
  },
};
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".geojson": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".woff2": "font/woff2" };

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname === "/api/lands-sync") {
      let text = "";
      for await (const chunk of req) text += chunk;
      let body = null;
      try { body = text ? JSON.parse(text) : null; } catch { body = null; }
      const auth = req.headers.authorization || "";
      const out = await handle(store, { method: req.method, code: auth.replace(/^Bearer /, ""), body, ip: "127.0.0.1" });
      res.writeHead(out.status, { "Content-Type": "application/json" });
      return res.end(JSON.stringify(out.json));
    }
    let path = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, "");
    if (path.endsWith("/")) path += "index.html";
    try {
      const data = await readFile(join(ROOT, path));
      res.writeHead(200, { "Content-Type": types[extname(path)] || "application/octet-stream" });
      res.end(data);
    } catch {
      res.writeHead(404).end("Not found");
    }
  })
  .listen(port, () => console.log(`Public lands tracker with sync: http://localhost:${port}/wilderness.html`));
