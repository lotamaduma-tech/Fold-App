const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const root = __dirname;
http
  .createServer((req, res) => {
    let pathname;
    try {
      pathname = decodeURIComponent(
        new URL(req.url, "http://localhost").pathname,
      );
    } catch {
      res.writeHead(400);
      res.end();
      return;
    }
    const file = path.resolve(
      root,
      "." + (pathname === "/" ? "/index.html" : pathname),
    );
    const allowed =
      /^(?:\/|\/(?:index|privacy|terms|disclaimer)\.html|\/config\.js|\/sw\.js|\/manifest\.webmanifest|\/(?:css|js|assets)\/[a-zA-Z0-9_.-]+)$/;
    if (!allowed.test(pathname) || !["GET", "HEAD"].includes(req.method)) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    if (!file.startsWith(root + path.sep)) {
      res.writeHead(403);
      res.end();
      return;
    }
    fs.readFile(file, (error, content) => {
      if (error) {
        res.writeHead(404);
        res.end("Not found");
        return;
      }
      res.writeHead(200, {
        "Content-Type":
          {
            ".html": "text/html; charset=utf-8",
            ".css": "text/css; charset=utf-8",
            ".js": "text/javascript; charset=utf-8",
            ".png": "image/png",
            ".webmanifest": "application/manifest+json",
          }[path.extname(file)] || "text/plain",
        "Cache-Control": "no-cache",
        "Referrer-Policy": "no-referrer",
        "X-Content-Type-Options": "nosniff",
        "X-Frame-Options": "DENY",
      });
      res.end(req.method === "HEAD" ? undefined : content);
    });
  })
  .listen(Number(process.env.PORT || 4173), "127.0.0.1", () =>
    console.log(`NectarSpend is open at http://127.0.0.1:${process.env.PORT || 4173}`),
  );
