import crypto from "node:crypto";
import net from "node:net";

// Returns the password from an `Authorization: Basic ...` header, or null when absent/malformed.
export function basicAuthPassword(header) {
  const [scheme, encoded] = String(header || "").split(" ");
  if (scheme !== "Basic" || !encoded) return null;
  const decoded = Buffer.from(encoded, "base64").toString("utf8");
  const idx = decoded.indexOf(":");
  return idx >= 0 ? decoded.slice(idx + 1) : "";
}

// Constant-time comparison; hashing first keeps timingSafeEqual inputs equal-length.
export function passwordMatches(candidate, expected) {
  if (typeof candidate !== "string" || typeof expected !== "string" || !expected) return false;
  const a = crypto.createHash("sha256").update(candidate, "utf8").digest();
  const b = crypto.createHash("sha256").update(expected, "utf8").digest();
  return crypto.timingSafeEqual(a, b);
}

export function isBasicAuthorization(value) {
  return typeof value === "string" && /^Basic\s/i.test(value);
}

// The dashboard password must never reach the gateway. Bearer credentials sent by
// API/webhook clients are left untouched.
export function stripBasicAuthorization(proxyReq) {
  if (isBasicAuthorization(proxyReq.getHeader("authorization"))) {
    proxyReq.removeHeader("authorization");
  }
}

function normalizeAddress(addr) {
  const s = String(addr || "").trim();
  return s.startsWith("::ffff:") ? s.slice(7) : s;
}

function isLoopback(addr) {
  return addr === "::1" || /^127\./.test(addr);
}

// Railway's edge appends the address it saw as the last X-Forwarded-For entry; anything to
// its left is client-controlled. Loopback is never accepted from a header, so a client
// cannot claim to be local.
export function clientAddress(req) {
  const last = normalizeAddress(String(req.headers["x-forwarded-for"] || "").split(",").at(-1));
  if (net.isIP(last) && !isLoopback(last)) return last;
  return normalizeAddress(req.socket?.remoteAddress) || "unknown";
}

// The gateway decides locality (and silent device-pairing approval) from forwarded headers,
// so client-supplied values must never pass through: rebuild them from clientAddress.
export function setForwardedHeaders(proxyReq, req) {
  for (const name of ["forwarded", "x-forwarded-for", "x-forwarded-host", "x-forwarded-proto", "x-forwarded-port", "x-real-ip"]) {
    proxyReq.removeHeader(name);
  }
  const lastProto = String(req.headers["x-forwarded-proto"] || "").split(",").at(-1).trim().toLowerCase();
  proxyReq.setHeader("x-forwarded-for", clientAddress(req));
  proxyReq.setHeader("x-forwarded-proto", lastProto === "https" ? "https" : "http");
  if (req.headers.host) proxyReq.setHeader("x-forwarded-host", req.headers.host);
}

// Browser origins allowed to drive the wrapper: the configured public origin, otherwise
// the Host the request arrived on (browsers cannot forge Host).
export function allowedOriginsFor(req, publicOrigin) {
  if (publicOrigin) return [publicOrigin];
  const host = String(req.headers.host || "").toLowerCase();
  return host ? [`https://${host}`, `http://${host}`] : [];
}

export function isAllowedOrigin(origin, allowed) {
  if (!origin) return true; // Non-browser clients (CLI, native apps) send no Origin.
  try {
    return allowed.includes(new URL(origin).origin);
  } catch {
    return false;
  }
}

// CSRF guard for state-changing requests: browsers attach cached Basic credentials to
// cross-site requests, so require evidence the request came from our own pages.
export function isSameOriginRequest(req, allowed) {
  const site = req.headers["sec-fetch-site"];
  if (site && site !== "same-origin" && site !== "none") return false;
  return isAllowedOrigin(req.headers.origin, allowed);
}

export function createFailureLimiter({ maxFailures, windowMs, now = () => Date.now() }) {
  const failures = new Map();

  function prune(key) {
    const entry = failures.get(key);
    if (entry && now() - entry.first > windowMs) failures.delete(key);
    return failures.get(key);
  }

  return {
    isBlocked(key) {
      const entry = prune(key);
      return Boolean(entry && entry.count >= maxFailures);
    },
    recordFailure(key) {
      const entry = prune(key) || { first: now(), count: 0 };
      entry.count += 1;
      failures.set(key, entry);
      if (failures.size > 10_000) failures.delete(failures.keys().next().value);
    },
    reset(key) {
      failures.delete(key);
    },
  };
}

// Values passed as a single CLI argument. A leading "-" would be parsed as a flag.
export function isSafeCliArg(value) {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(value);
}

// Browser connections through the public Railway domain need gateway.publicOrigin.
export function resolvePublicOrigin(env) {
  const explicit = env.OPENCLAW_PUBLIC_ORIGIN?.trim();
  if (explicit) {
    try {
      const url = new URL(explicit);
      if (url.protocol !== "https:" && url.protocol !== "http:") return null;
      return url.origin;
    } catch {
      return null;
    }
  }

  const domain = env.RAILWAY_PUBLIC_DOMAIN?.trim().toLowerCase();
  if (domain && /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(domain)) {
    return `https://${domain}`;
  }
  return null;
}
