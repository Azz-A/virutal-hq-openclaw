import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import {
  compareVersions,
  decideMigration,
  decideStartup,
  isEnvFlagSet,
  isMigrationAllowed,
  parseOpenClawVersion,
  stateVersionFromConfig,
} from "../src/migration.js";

const src = fs.readFileSync(new URL("../src/server.js", import.meta.url), "utf8");

function fnBody(name) {
  const start = src.indexOf(`async function ${name}(`);
  assert.ok(start >= 0, `${name} not found`);
  const next = src.indexOf("\nasync function ", start + 1);
  const nextSync = src.indexOf("\nfunction ", start + 1);
  const end = Math.min(...[next, nextSync].filter((i) => i > 0));
  return src.slice(start, end);
}

test("parseOpenClawVersion reads `openclaw --version` output", () => {
  assert.equal(parseOpenClawVersion("OpenClaw 2026.10.3 (59cb447)"), "2026.10.3");
  assert.equal(parseOpenClawVersion("[spawn error] ENOENT"), null);
});

test("compareVersions orders calendar versions numerically", () => {
  assert.ok(compareVersions("2026.10.3", "2026.9.5") > 0);
  assert.ok(compareVersions("2026.3.8", "2026.10.3") < 0);
  assert.equal(compareVersions("2026.10.3", "2026.10.3"), 0);
});

test("stateVersionFromConfig reads meta.lastTouchedVersion", () => {
  assert.equal(stateVersionFromConfig('{"meta":{"lastTouchedVersion":"2026.3.8"}}'), "2026.3.8");
  assert.equal(stateVersionFromConfig("{}"), null);
  assert.equal(stateVersionFromConfig("{ json5: 'not strict json' }"), null);
});

test("env flags require an explicit truthy value", () => {
  assert.equal(isEnvFlagSet(undefined), false);
  assert.equal(isEnvFlagSet("0"), false);
  assert.equal(isEnvFlagSet(" yes "), true);
  assert.equal(isMigrationAllowed({}), false);
  assert.equal(isMigrationAllowed({ OPENCLAW_ALLOW_STATE_MIGRATION: "1" }), true);
});

test("startup only starts the gateway on state owned by the installed version", () => {
  assert.deepEqual(decideStartup({ stateVersion: "2026.10.3", runningVersion: "2026.10.3" }), { action: "start" });

  const legacy = decideStartup({ stateVersion: "2026.3.8", runningVersion: "2026.10.3" });
  assert.equal(legacy.action, "refuse");
  assert.match(legacy.reason, /2026\.3\.8.*2026\.10\.3/);
  assert.match(legacy.reason, /maintenance\.migrate/);

  assert.equal(decideStartup({ stateVersion: null, runningVersion: "2026.10.3" }).action, "refuse");
  assert.match(decideStartup({ stateVersion: "2026.10.3", runningVersion: "2026.9.5" }).reason, /newer/);
  assert.equal(decideStartup({ stateVersion: "2026.10.3", runningVersion: null }).action, "refuse");
});

test("migration needs consent and never opens state from a newer release", () => {
  assert.equal(decideMigration({ stateVersion: "2026.3.8", runningVersion: "2026.9.5", allowMigration: false }).action, "refuse");
  assert.deepEqual(decideMigration({ stateVersion: "2026.3.8", runningVersion: "2026.9.5", allowMigration: true }), { action: "migrate" });
  assert.deepEqual(decideMigration({ stateVersion: null, runningVersion: "2026.10.3", allowMigration: true }), { action: "migrate" });
  assert.equal(decideMigration({ stateVersion: "2026.10.3", runningVersion: "2026.9.5", allowMigration: true }).action, "refuse");
  assert.equal(decideMigration({ stateVersion: "2026.3.8", runningVersion: null, allowMigration: true }).action, "refuse");
});

test("normal gateway startup never runs doctor --fix", () => {
  for (const name of ["runStartupChecks", "ensureGatewayRunning", "restartGateway", "startGateway"]) {
    assert.doesNotMatch(fnBody(name), /"--fix"/, `${name} must not run doctor --fix`);
  }
  const occurrences = [...src.matchAll(/"doctor", "--fix"/g)];
  assert.equal(occurrences.length, 1, "doctor --fix may only appear in the explicit migration job");
  assert.match(fnBody("startStateMigration"), /"doctor", "--fix", "--non-interactive"/);
});

test("a refused startup check writes nothing before refusing", () => {
  const body = fnBody("runStartupChecks");
  const refuse = body.indexOf('decision.action !== "start"');
  assert.ok(refuse > 0);
  assert.ok(refuse < body.indexOf("syncGatewayConfig()"));
});

test("migration is consent-gated, bounded, and reports timeouts", () => {
  const body = fnBody("startStateMigration");
  assert.ok(body.indexOf("decideMigration(") < body.indexOf('"doctor", "--fix"'));
  assert.match(body, /timeoutMs: MIGRATION_TIMEOUT_MS/);
  assert.match(body, /killGraceMs: MIGRATION_KILL_GRACE_MS/);
  assert.match(body, /r\.code === 124/);
  assert.match(src, /const MIGRATION_TIMEOUT_MS = Number\.parseInt\(process\.env\.OPENCLAW_MIGRATION_TIMEOUT_MS \?\? String\(30 \* 60 \* 1000\)/);
});

test("every command runs with a timeout", () => {
  assert.doesNotMatch(src, /timeoutMs: 0\b/);
  assert.match(src, /rawTimeout > 0 \? rawTimeout : 120_000/);
});
