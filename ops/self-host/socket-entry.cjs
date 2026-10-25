// Container entry for the self-hosted site. Next's standalone server listens on
// TCP only, so it runs on 127.0.0.1 inside the container, and this process
// forwards the Unix socket that the host's Caddy connects to (the container has
// no published port). Bytes pass through unchanged, X-Forwarded-For included.
const fs = require("node:fs");
const net = require("node:net");

const socket = process.env.SITE_SOCKET || "/run/dsatoolkit/site.sock";
const port = Number(process.env.PORT || 3000);
process.env.HOSTNAME = "127.0.0.1";

require("./server.js");

fs.rmSync(socket, { force: true }); // a socket left by a crashed container
const forward = net.createServer((client) => {
  const upstream = net.connect(port, "127.0.0.1");
  client.on("error", () => upstream.destroy());
  upstream.on("error", () => client.destroy());
  client.pipe(upstream).pipe(client);
});
forward.listen(socket, () => {
  // Caddy runs as another user.
  fs.chmodSync(socket, 0o666);
  console.log(`forwarding ${socket} to 127.0.0.1:${port}`);
});
const stop = () => forward.close(() => process.exit(0));
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
