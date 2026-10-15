// Version guard for the mounted /data state. Startup only starts the gateway on state the
// installed OpenClaw version already owns; changing owners is an explicit maintenance
// operation (`doctor --fix`), because Doctor migrations are one-way.

export function parseOpenClawVersion(text) {
  const m = String(text || "").match(/\b(\d{4}\.\d+\.\d+)\b/);
  return m ? m[1] : null;
}

export function compareVersions(a, b) {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

// Reads meta.lastTouchedVersion, which OpenClaw stamps on every config write.
export function stateVersionFromConfig(configText) {
  try {
    const v = JSON.parse(configText)?.meta?.lastTouchedVersion;
    return typeof v === "string" ? parseOpenClawVersion(v) : null;
  } catch {
    return null;
  }
}

export function isEnvFlagSet(value) {
  return /^(1|true|yes)$/i.test(String(value || "").trim());
}

export function isMigrationAllowed(env) {
  return isEnvFlagSet(env.OPENCLAW_ALLOW_STATE_MIGRATION);
}

function newerStateReason(stateVersion, runningVersion) {
  return `state was written by newer OpenClaw ${stateVersion}; ${runningVersion} cannot safely open it`;
}

export function decideStartup({ stateVersion, runningVersion }) {
  if (!runningVersion) {
    return { action: "refuse", reason: "could not determine the installed OpenClaw version" };
  }
  if (stateVersion === runningVersion) return { action: "start" };
  if (stateVersion && compareVersions(stateVersion, runningVersion) > 0) {
    return { action: "refuse", reason: newerStateReason(stateVersion, runningVersion) };
  }
  return {
    action: "refuse",
    reason:
      `state was last written by OpenClaw ${stateVersion ?? "(unknown version)"} but ${runningVersion} is installed. ` +
      "Back up /data (/setup/export), set OPENCLAW_ALLOW_STATE_MIGRATION=1, redeploy, then run " +
      '"maintenance.migrate" from the /setup Debug Console. Releases older than 2026.7 must go through ' +
      "the 2026.9.5 bridge first (see README).",
  };
}

export function decideMigration({ stateVersion, runningVersion, allowMigration }) {
  if (!runningVersion) {
    return { action: "refuse", reason: "could not determine the installed OpenClaw version" };
  }
  if (stateVersion && compareVersions(stateVersion, runningVersion) > 0) {
    return { action: "refuse", reason: newerStateReason(stateVersion, runningVersion) };
  }
  if (!allowMigration) {
    return {
      action: "refuse",
      reason: "state migration is disabled: back up /data, set OPENCLAW_ALLOW_STATE_MIGRATION=1, and redeploy first",
    };
  }
  return { action: "migrate" };
}
