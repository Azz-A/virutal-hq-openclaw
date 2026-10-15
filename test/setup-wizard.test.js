import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const src = fs.readFileSync(new URL("../src/server.js", import.meta.url), "utf8");

// `openclaw onboard --help` (2026.10.3) --auth-choice values the wizard may offer. Re-check on version bumps.
const VERIFIED_AUTH_CHOICES = new Set([
  "openai-api-key", "token", "apiKey", "gemini-api-key", "openrouter-api-key", "ai-gateway-api-key",
  "moonshot-api-key", "kimi-code-api-key", "zai-api-key", "minimax-global-api", "minimax-cn-api",
  "synthetic-api-key", "opencode-zen",
]);

test("wizard only offers auth choices verified against the pinned OpenClaw CLI", () => {
  const start = src.indexOf("const AUTH_GROUPS = [");
  const block = src.slice(start, src.indexOf("\n];", start));
  // Option rows are indented one level deeper than group rows and have no hint/options.
  const optionValues = [...block.matchAll(/^\s+\{ value: "([^"]+)", label: "[^"]+" \},?\r?$/gm)].map((m) => m[1]);
  assert.ok(optionValues.length >= 10, "expected to parse AUTH_GROUPS options");
  for (const v of optionValues) assert.ok(VERIFIED_AUTH_CHOICES.has(v), `unverified auth choice: ${v}`);
});

test("every secret-taking auth choice maps to an onboard flag", () => {
  for (const choice of ["openai-api-key", "apiKey", "gemini-api-key", "minimax-global-api", "minimax-cn-api"]) {
    assert.match(src, new RegExp(`"${choice}": "--[a-z-]+-api-key"`), choice);
  }
});

test("channel configs use current (post-2026.7) keys", () => {
  assert.doesNotMatch(src, /streamMode:/, "channels.*.streamMode is retired; use streaming.mode");
  assert.match(src, /streaming: \{ mode: "partial" \}/);
  assert.doesNotMatch(src, /dm: \{\s*policy:/, "discord dm.policy is legacy; use dmPolicy");
});

test("channel integrations are opt-in (OPENCLAW_SETUP_CHANNELS)", () => {
  assert.match(src, /const SETUP_CHANNELS_ENABLED = isEnvFlagSet\(process\.env\.OPENCLAW_SETUP_CHANNELS\)/);
  for (const field of ["telegramToken", "discordToken", "slackBotToken"]) {
    assert.match(src, new RegExp(`if \\(SETUP_CHANNELS_ENABLED && \\(?payload\\.${field}`), `${field} must be gated`);
  }
});

test("removed CLI flags are not used", () => {
  assert.doesNotMatch(src, /"logs", "--tail"/);
});
