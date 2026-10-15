import fs from "node:fs";

const owner = "openclaw";
const repo = "openclaw";
const imageRepo = "openclaw/openclaw";
const token = process.env.GITHUB_TOKEN;
if (!token) {
  console.error("Missing GITHUB_TOKEN");
  process.exit(2);
}

async function gh(path) {
  const url = `https://api.github.com${path}`;
  const res = await fetch(url, {
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/vnd.github+json",
      "user-agent": "clawdbot-railway-template-bot",
    },
  });
  if (!res.ok) {
    throw new Error(`GitHub API ${res.status}: ${await res.text()}`);
  }
  return res.json();
}

// Resolves the multi-arch index digest so the Dockerfile pins exactly what was published.
async function ghcrDigest(tag) {
  const tokenRes = await fetch(`https://ghcr.io/token?scope=repository:${imageRepo}:pull`);
  if (!tokenRes.ok) throw new Error(`GHCR token ${tokenRes.status}`);
  const { token: pullToken } = await tokenRes.json();

  const res = await fetch(`https://ghcr.io/v2/${imageRepo}/manifests/${tag}`, {
    method: "HEAD",
    headers: {
      authorization: `Bearer ${pullToken}`,
      accept: "application/vnd.oci.image.index.v1+json,application/vnd.docker.distribution.manifest.list.v2+json",
    },
  });
  if (!res.ok) throw new Error(`GHCR manifest ${tag}: ${res.status}`);
  const digest = res.headers.get("docker-content-digest");
  if (!digest?.startsWith("sha256:")) throw new Error(`GHCR manifest ${tag}: missing digest`);
  return digest;
}

const IMAGE_LINE = /^ARG OPENCLAW_IMAGE=ghcr\.io\/openclaw\/openclaw:([0-9.]+)@(sha256:[0-9a-f]{64})(?=\r?$)/m;

function compareVersions(a, b) {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

const dockerPath = "Dockerfile";
const docker = fs.readFileSync(dockerPath, "utf8");
const current = docker.match(IMAGE_LINE);
if (!current) throw new Error("Could not parse current OPENCLAW_IMAGE line");
const currentVersion = current[1];

// releases/latest never returns prereleases.
const latest = await gh(`/repos/${owner}/${repo}/releases/latest`);
const latestVersion = latest.tag_name?.replace(/^v/, "");
if (!latestVersion || !/^[0-9]+(\.[0-9]+)+$/.test(latestVersion)) {
  throw new Error(`Unexpected latest release tag: ${latest.tag_name}`);
}

console.log(`current=${currentVersion} latest=${latestVersion}`);

if (compareVersions(latestVersion, currentVersion) <= 0) {
  console.log("No update needed.");
  process.exit(0);
}

const digest = await ghcrDigest(latestVersion);
const next = docker.replace(IMAGE_LINE, `ARG OPENCLAW_IMAGE=ghcr.io/${imageRepo}:${latestVersion}@${digest}`);
fs.writeFileSync(dockerPath, next);
console.log(`Updated ${dockerPath} to ${latestVersion}@${digest}`);
