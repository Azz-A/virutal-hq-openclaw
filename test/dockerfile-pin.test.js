import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const dockerfile = fs.readFileSync(new URL("../Dockerfile", import.meta.url), "utf8");
const server = fs.readFileSync(new URL("../src/server.js", import.meta.url), "utf8");

// Keep in sync with IMAGE_LINE in scripts/bump-openclaw-ref.mjs.
const IMAGE_LINE = /^ARG OPENCLAW_IMAGE=ghcr\.io\/openclaw\/openclaw:([0-9.]+)@(sha256:[0-9a-f]{64})(?=\r?$)/m;

test("Dockerfile pins the official OpenClaw image by version and digest", () => {
  const m = dockerfile.match(IMAGE_LINE);
  assert.ok(m, "OPENCLAW_IMAGE must be <version>@sha256:<digest> so the bump script can parse it");
  assert.match(dockerfile, /^FROM \$\{OPENCLAW_IMAGE\}\r?$/m);
});

test("wrapper's default OpenClaw entry matches the image layout", () => {
  assert.match(dockerfile, /ENV OPENCLAW_ENTRY=\/app\/openclaw\.mjs/);
  assert.match(server, /\|\| "\/app\/openclaw\.mjs"/);
  assert.doesNotMatch(dockerfile, /WORKDIR \/app\b/);
});

test("public /healthz does not expose internal paths or error text", () => {
  const idx = server.indexOf('app.get("/healthz"');
  assert.ok(idx >= 0);
  const window = server.slice(idx, server.indexOf("});", idx));
  assert.doesNotMatch(window, /STATE_DIR|WORKSPACE_DIR|GATEWAY_TARGET|lastError:|lastExit/);
});

test("gateway start runs the version guard before spawning", () => {
  const idx = server.indexOf("async function ensureGatewayRunning");
  assert.ok(idx >= 0);
  const window = server.slice(idx, idx + 1200);
  assert.ok(window.indexOf("runStartupChecks") > 0);
  assert.ok(window.indexOf("runStartupChecks") < window.indexOf("startGateway()"));
});
