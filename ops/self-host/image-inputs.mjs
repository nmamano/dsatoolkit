// Digest of the source files the site image is built from. The image workflow skips
// the build and push when an image with this digest exists, so a push that changes
// only docs or deploy files does not restart the site.
// Usage: node ops/self-host/image-inputs.mjs   -> prints a sha256 hex digest
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";

// Tracked paths that never reach the image. Everything else counts.
const OUTSIDE = [/^\.github\//, /^ops\//];
// Files under ops/ that the image does contain (Dockerfile, stage-image.mjs).
const INSIDE = new Set(["ops/self-host/socket-entry.cjs", "ops/self-host/egress-proxy.mjs", "ops/self-host/stage-image.mjs"]);

export function imageInputs(root = ".") {
  // `git ls-files -s`: mode, blob hash and path of each tracked file.
  return execFileSync("git", ["ls-files", "-s"], { cwd: root, encoding: "utf8" })
    .split("\n")
    .filter(Boolean)
    .map((line) => line.split("\t"))
    .filter(([, path]) => INSIDE.has(path) || !OUTSIDE.some((re) => re.test(path)))
    .map(([meta, path]) => `${path}\0${meta}`)
    .sort();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(createHash("sha256").update(imageInputs().join("\n")).digest("hex"));
}
