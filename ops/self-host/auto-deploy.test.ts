// Run: bun test ops/self-host
// ops/self-host/auto-deploy.sh against a fake docker, a fake health probe and a stub
// registry, GitHub API and Cloudflare API. Nothing here touches a real registry, GitHub,
// Cloudflare or Docker. Vendored from nilmamano.com (ops/self-host/auto-deploy.test.ts).
import { afterAll, beforeAll, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, type Server } from "node:http";
import { spawn } from "node:child_process";
import type { AddressInfo } from "node:net";

const IMAGE = "ghcr.io/nmamano/dsatoolkit-site";
const ZONE = "0123456789abcdef0123456789abcdef";
const script = join(import.meta.dir, "auto-deploy.sh");
const dir = mkdtempSync(join(tmpdir(), "dsa-deploy-"));
const root = join(dir, "root"), envDir = join(dir, "etc"), fake = join(dir, "fake"), units = join(dir, "units");
for (const path of [root, fake, units, join(fake, "labels")]) mkdirSync(path, { recursive: true });
mkdirSync(envDir, { mode: 0o700 });
const config = (extra = "") =>
  writeFileSync(
    join(envDir, "auto-deploy.env"),
    `DSA_IMAGE=${IMAGE}\nDSA_GITHUB_REPO=nmamano/dsatoolkit\nDSA_IMAGE_WORKFLOW=site-image.yml\nDSA_CF_ZONE=${ZONE}\n${extra}`,
    { mode: 0o600 }
  );
config();
writeFileSync(join(envDir, "purge-token"), "stub-purge-token\n", { mode: 0o600 });
const digest = (n: number) => "sha256:" + String(n).repeat(64).slice(0, 64);
const commit = (n: number) => String(n).repeat(40).slice(0, 40);
for (const n of [1, 2, 3, 4, 5]) writeFileSync(join(fake, "labels", digest(n)), commit(n));
writeFileSync(join(root, "compose.yaml"), "services: {}\n");
writeFileSync(join(root, "release.env"), `DSA_UID=990\nDSA_GID=990\nDSA_SITE_IMAGE=${IMAGE}@${digest(1)}\n`);
writeFileSync(join(root, "release.commit"), commit(1) + "\n");
writeFileSync(join(fake, "running"), digest(1));
writeFileSync(join(fake, "unhealthy"), "");
// The local images of this repo, plus one of another project that must never be removed.
writeFileSync(join(fake, "images"), `${IMAGE}@${digest(1)}\nghcr.io/other/site@${digest(9)}\n`);

// docker: pull adds the image; image inspect reads the fake labels; image ls lists the
// repo's images; image rm drops one; `compose up` starts whatever release.env names and
// fails for an unhealthy digest. The probe prints what runs, if it is healthy.
writeFileSync(
  join(fake, "docker"),
  `#!/usr/bin/env bash
fake=${fake}
case $1 in
pull) grep -qx "\${3##*@}" "$fake/pull-fail" 2>/dev/null && exit 1; echo "$3" >> "$fake/images"; exit 0 ;;
image)
  case $2 in
  ls) grep "^\${@: -1}@" "$fake/images" ;;
  rm) grep -vx "$3" "$fake/images" > "$fake/images.tmp"; mv "$fake/images.tmp" "$fake/images"; echo "$3" >> "$fake/removed" ;;
  *) ref=\${@: -1}; cat "$fake/labels/\${ref##*@}" ;;
  esac ;;
compose)
  for ((i=1; i<=$#; i++)); do [[ \${!i} == --env-file ]] && { j=$((i+1)); env_file=\${!j}; }; done
  d=$(sed -n 's/^DSA_SITE_IMAGE=.*@//p' "$env_file"); echo "$d" > "$fake/running"
  grep -qx "$d" "$fake/unhealthy" && exit 1; exit 0 ;;
esac
`,
  { mode: 0o755 }
);
writeFileSync(
  join(fake, "probe"),
  `#!/usr/bin/env bash
d=$(cat ${fake}/running); grep -qx "$d" ${fake}/unhealthy && exit 1; echo "$d"
`,
  { mode: 0o755 }
);

// Stub registry, GitHub API and Cloudflare API. The runs endpoint answers 304 to a
// matching ETag. The purge endpoint fails `purgeFailures` times, then succeeds.
let mainDigest = digest(1), runStatus = "completed", apiFails = false, purgeFailures = 0;
const served = { ok: 0, notModified: 0 };
const purges: { auth?: string; body: string; ok: boolean }[] = [];
let server: Server;
beforeAll(async () => {
  server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://stub");
    if (url.pathname === "/token") return res.end(JSON.stringify({ token: "stub" }));
    if (url.pathname === "/v2/nmamano/dsatoolkit-site/manifests/main") {
      res.writeHead(200, { "Docker-Content-Digest": mainDigest });
      return res.end();
    }
    if (url.pathname === "/repos/nmamano/dsatoolkit/actions/workflows/site-image.yml/runs") {
      if (apiFails) {
        res.writeHead(500);
        return res.end();
      }
      const etag = `W/"${runStatus}"`;
      if (req.headers["if-none-match"] === etag) {
        served.notModified++;
        res.writeHead(304, { ETag: etag });
        return res.end();
      }
      served.ok++;
      res.writeHead(200, { ETag: etag, "Content-Type": "application/json" });
      return res.end(JSON.stringify({ workflow_runs: [{ status: runStatus }] }));
    }
    if (url.pathname === `/zones/${ZONE}/purge_cache` && req.method === "POST") {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        const ok = purgeFailures-- <= 0;
        purges.push({ auth: req.headers.authorization, body, ok });
        res.writeHead(ok ? 200 : 500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: ok }));
      });
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
});
afterAll(() => {
  server.close();
  rmSync(dir, { recursive: true, force: true });
});

const base = () => `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
// spawnSync would block the stub server in this process, so the tick runs asynchronously.
function tick(): Promise<{ status: Record<string, unknown>; output: string }> {
  return new Promise((done) => {
    const child = spawn("bash", [script], {
      env: {
        PATH: process.env.PATH,
        DSA_ROOT: root, DSA_ENV_DIR: envDir, DSA_UNIT_DIR: units, DSA_DOCKER: join(fake, "docker"),
        DSA_PROBE: join(fake, "probe"), DSA_REGISTRY: base(), DSA_GITHUB_API: base(), DSA_CF_API: base(), DSA_RETRY_SLEEP: "0",
      },
    });
    let output = "";
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (output += chunk));
    child.on("close", () => done({ status: JSON.parse(readFileSync(join(root, "auto-deploy/status.json"), "utf8")), output }));
  });
}
const lines = (file: string) => (existsSync(file) ? readFileSync(file, "utf8").trim().split("\n").filter(Boolean) : []);
const failed = () => lines(join(root, "auto-deploy/failed"));
const images = () => lines(join(fake, "images"));

test("status.json has exactly the Hosted Isomux fields, in order; an unchanged tag is up to date", async () => {
  const { status } = await tick();
  expect(Object.keys(status)).toEqual(["tick_at", "deployed", "result", "phase", "target", "stopped", "held", "waiting", "waiting_since", "tick_error_since", "units", "last_attempt"]);
  expect(Object.keys(status.last_attempt as object)).toEqual(["at", "target", "result"]);
  expect(status.result).toBe("up_to_date");
  expect(status.deployed).toBe(commit(1));
  expect(status.units).toBe("absent");
  expect(purges).toHaveLength(0);
  // The second read sends the ETag and gets a 304, which does not count against the API limit.
  await tick();
  expect(served).toEqual({ ok: 1, notModified: 1 });
});

test("a running image workflow is waiting; a new main digest deploys and purges the zone", async () => {
  runStatus = "in_progress";
  let { status } = await tick();
  expect(status.result).toBe("waiting");
  expect(status.waiting).toBe(true);
  runStatus = "completed";
  mainDigest = digest(2);
  ({ status } = await tick());
  expect(status.result).toBe("deployed");
  expect(status.deployed).toBe(commit(2));
  // The image line changes; the dedicated uid and gid stay.
  expect(readFileSync(join(root, "release.env"), "utf8")).toBe(`DSA_UID=990\nDSA_GID=990\nDSA_SITE_IMAGE=${IMAGE}@${digest(2)}\n`);
  expect(purges).toEqual([{ auth: "Bearer stub-purge-token", body: '{"purge_everything":true}', ok: true }]);
});

test("a deploy keeps only the running image and the rollback image, and never another project's", async () => {
  mainDigest = digest(3);
  const { status } = await tick();
  expect(status.result).toBe("deployed");
  expect(images().sort()).toEqual([`${IMAGE}@${digest(2)}`, `${IMAGE}@${digest(3)}`, `ghcr.io/other/site@${digest(9)}`].sort());
  expect(lines(join(fake, "removed"))).toEqual([`${IMAGE}@${digest(1)}`]);
});

test("a failed purge is retried, logged, and does not fail the deploy", async () => {
  purgeFailures = 5;
  const before = purges.length;
  mainDigest = digest(4);
  const { status, output } = await tick();
  expect(status.result).toBe("deployed");
  expect(purges.length - before).toBe(3);
  expect(output).toContain("the Cloudflare purge failed 3 times");
  expect(existsSync(join(root, "auto-deploy/purge-failed-at"))).toBe(true);
  purgeFailures = 1;
  writeFileSync(join(fake, "labels", digest(6)), commit(6));
  mainDigest = digest(6);
  expect((await tick()).output).toContain("purged the Cloudflare cache (try 2)");
});

test("an unhealthy image rolls back by itself, purges, and is not tried again", async () => {
  writeFileSync(join(fake, "unhealthy"), digest(5) + "\n");
  mainDigest = digest(5);
  const before = purges.length;
  let { status } = await tick();
  expect(status.result).toBe("rolled_back");
  expect(status.deployed).toBe(commit(6));
  expect(readFileSync(join(fake, "running"), "utf8").trim()).toBe(digest(6));
  expect(failed()).toEqual([digest(5)]);
  expect(purges.length - before).toBe(1);
  ({ status } = await tick());
  expect(status.result).toBe("failed_target");
});

test("without a zone or a token, a deploy runs and skips the purge", async () => {
  writeFileSync(join(envDir, "auto-deploy.env"), `DSA_IMAGE=${IMAGE}\nDSA_GITHUB_REPO=nmamano/dsatoolkit\nDSA_IMAGE_WORKFLOW=site-image.yml\n`, { mode: 0o600 });
  writeFileSync(join(fake, "labels", digest(7)), commit(7));
  mainDigest = digest(7);
  const before = purges.length;
  const { status, output } = await tick();
  expect(status.result).toBe("deployed");
  expect(purges.length).toBe(before);
  expect(output).toContain("purge skipped");
  config();
});

test("API errors, hold, lock and bad config deploy nothing", async () => {
  apiFails = true;
  let { status } = await tick();
  expect(status.result).toBe("tick_error");
  apiFails = false;
  writeFileSync(join(envDir, "auto-deploy.hold"), "");
  ({ status } = await tick());
  expect(status.result).toBe("held");
  rmSync(join(envDir, "auto-deploy.hold"));
  const holder = spawn("flock", [join(root, "deploy.lock"), "sleep", "1"]);
  const released = new Promise((done) => holder.on("close", done));
  await new Promise((done) => setTimeout(done, 300));
  ({ status } = await tick());
  expect(status.result).toBe("locked");
  await released;
  chmodSync(join(envDir, "auto-deploy.env"), 0o644);
  ({ status } = await tick());
  expect(status.phase).toBe("config");
  chmodSync(join(envDir, "auto-deploy.env"), 0o600);
  config("DSA_CF_ZONE=not-a-zone\n");
  expect((await tick()).status.phase).toBe("config");
  config();
});

test("a failed rollback stops every later tick until the marker is deleted", async () => {
  writeFileSync(join(fake, "labels", digest(8)), commit(8));
  mainDigest = digest(8);
  // The new image fails and the previous one no longer runs healthy either.
  writeFileSync(join(fake, "unhealthy"), [digest(8), digest(7)].join("\n") + "\n");
  let { status } = await tick();
  expect(status.result).toBe("rollback_failed");
  expect(status.stopped).toBe(true);
  ({ status } = await tick());
  expect(status.result).toBe("stopped");
});
