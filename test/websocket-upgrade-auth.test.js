import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const src = fs.readFileSync(new URL("../src/server.js", import.meta.url), "utf8");

test("ws upgrade handler does not enforce Basic auth (browsers can't send headers)", () => {
  const idx = src.indexOf('server.on("upgrade"');
  assert.ok(idx >= 0);
  const window = src.slice(idx, idx + 700);

  // Regression guard for issue #162: do not destroy browser websocket connections
  // due to missing Authorization: Basic.
  assert.doesNotMatch(window, /WebSocket password protection/);
  assert.doesNotMatch(window, /scheme === "Basic"/);
  assert.doesNotMatch(window, /WWW-Authenticate/);
});

test("wrapper never injects the gateway admin token into proxied traffic", () => {
  // Unauthenticated upgrades previously received `Bearer <gateway token>`, granting
  // gateway admin to anyone who could reach the public URL.
  assert.doesNotMatch(src, /Bearer \$\{OPENCLAW_GATEWAY_TOKEN\}/);
  assert.doesNotMatch(src, /headers\.authorization\s*=/);
});

test("dashboard auth fails closed without SETUP_PASSWORD", () => {
  const idx = src.indexOf("function requireDashboardAuth");
  assert.ok(idx >= 0);
  const window = src.slice(idx, idx + 800);
  assert.doesNotMatch(window, /if \(!SETUP_PASSWORD\) return next\(\)/);
  assert.match(window, /status\(503\)/);
});
