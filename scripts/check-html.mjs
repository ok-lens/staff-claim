import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../app/index.html", import.meta.url), "utf8");
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(match => match[1]);
for (const script of scripts) new Function(script);
console.log(`JS syntax OK, scripts: ${scripts.length}`);
