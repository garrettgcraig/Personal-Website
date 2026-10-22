// Local server for trying the ChronoSono game without Netlify: serves the site and runs the
// room API in memory. Use --fake-ids to give every song a made-up Spotify ID, so games work
// before the catalog workflow has filled in real ones.
//
//   node tests/chronosono-dev-server.mjs [--port 8787] [--fake-ids]
import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import * as R from "../chronosono/room.js";
import { SONGS } from "../chronosono/songs.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const args = process.argv.slice(2);
const port = Number(args[args.indexOf("--port") + 1]) || 8787;
const fakeIds = args.includes("--fake-ids");

const fakeId = (i) => `FAKE${String(i).padStart(18, "0")}`;
const rows = fakeIds ? SONGS.map(([t, a, y, id], i) => [t, a, y, id || fakeId(i)]) : SONGS;
if (fakeIds) R.setCatalogForTests(rows);
const songsModule = `export const SONGS = ${JSON.stringify(rows)};\n`;

const store = R.memoryStore();
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".svg": "image/svg+xml" };

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname.startsWith("/chronosono/api/")) {
      let body = {};
      if (req.method === "POST") {
        const chunks = [];
        for await (const c of req) chunks.push(c);
        try {
          body = JSON.parse(Buffer.concat(chunks).toString() || "{}");
        } catch {}
      }
      const out = await R.handle(store, { method: req.method, path: url.pathname.replace("/chronosono/api/", ""), query: Object.fromEntries(url.searchParams), body });
      res.writeHead(out.status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      return res.end(JSON.stringify(out.json));
    }
    if (url.pathname === "/chronosono/songs.js") {
      res.writeHead(200, { "Content-Type": types[".js"] });
      return res.end(songsModule);
    }
    let path = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, "");
    if (path.endsWith("/")) path += "index.html";
    try {
      const data = await readFile(join(ROOT, path));
      res.writeHead(200, { "Content-Type": types[extname(path)] || "application/octet-stream" });
      res.end(data);
    } catch {
      res.writeHead(404);
      res.end("Not found");
    }
  })
  .listen(port, "127.0.0.1", () => console.log(`ChronoSono dev server on http://127.0.0.1:${port}/chronosono/${fakeIds ? " (fake Spotify IDs)" : ""}`));
