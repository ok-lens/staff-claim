import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../app/", import.meta.url));
const port = Number(process.env.PORT || 5173);
const types = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".webmanifest", "application/manifest+json; charset=utf-8"],
  [".svg", "image/svg+xml"]
]);

createServer(async (request, response) => {
  const url = new URL(request.url || "/", `http://localhost:${port}`);
  const requested = normalize(url.pathname === "/" ? "/index.html" : url.pathname).replace(/^([/\\])+/, "");
  const filePath = join(root, requested);
  try {
    const body = await readFile(filePath);
    response.writeHead(200, { "content-type": types.get(extname(filePath)) || "application/octet-stream" });
    response.end(body);
  } catch {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found");
  }
}).listen(port, () => {
  console.log(`Staff Claim App preview: http://localhost:${port}`);
});
