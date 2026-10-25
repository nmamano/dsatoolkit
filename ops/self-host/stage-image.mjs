// Stages the build into .image/app/, the one image layer (the Dockerfile copies it).
// public/ is about 4 MB, so it shares the layer with the app (nilmamano.com splits its
// 393 MB public/ by post year; this site does not need that). Every file and folder gets
// one fixed mtime, so an unchanged build has the same layer digest.
// Usage (after `bun run build`): node ops/self-host/stage-image.mjs
import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, rmSync, utimesSync } from "node:fs";
import { join } from "node:path";

const FIXED_TIME = new Date("2000-01-01T00:00:00Z");

function setTimes(path) {
  if (lstatSync(path).isDirectory()) for (const entry of readdirSync(path)) setTimes(join(path, entry));
  utimesSync(path, FIXED_TIME, FIXED_TIME);
}

export function stage(root, out = join(root, ".image")) {
  const app = join(out, "app");
  rmSync(out, { recursive: true, force: true });
  mkdirSync(app, { recursive: true });
  const standalone = join(root, ".next", "standalone");
  if (!existsSync(join(standalone, "server.js"))) throw new Error("no .next/standalone/server.js: run the build first");
  cpSync(standalone, app, { recursive: true });
  const copy = (from, to = from) => cpSync(join(root, from), join(app, to), { recursive: true });
  copy("public");
  copy(join(".next", "static"));
  copy("ops/self-host/socket-entry.cjs", "socket-entry.cjs");
  copy("ops/self-host/egress-proxy.mjs", "egress-proxy.mjs");
  setTimes(out);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  stage(process.cwd());
  console.log("staged .image/app");
}
