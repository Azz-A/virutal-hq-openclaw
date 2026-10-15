import test from "node:test";
import assert from "node:assert/strict";

import {
  allowedOriginsFor,
  basicAuthPassword,
  clientAddress,
  createFailureLimiter,
  isAllowedOrigin,
  isSafeCliArg,
  isSameOriginRequest,
  passwordMatches,
  resolvePublicOrigin,
  setForwardedHeaders,
  stripBasicAuthorization,
} from "../src/security.js";

const basic = (userPass) => `Basic ${Buffer.from(userPass).toString("base64")}`;

test("basicAuthPassword parses Basic credentials and ignores other schemes", () => {
  assert.equal(basicAuthPassword(basic("any:s3cret")), "s3cret");
  assert.equal(basicAuthPassword(basic("any:pa:ss")), "pa:ss");
  assert.equal(basicAuthPassword(basic("nocolon")), "");
  assert.equal(basicAuthPassword("Bearer abc"), null);
  assert.equal(basicAuthPassword(""), null);
  assert.equal(basicAuthPassword(undefined), null);
});

test("passwordMatches requires an exact, non-empty expected password", () => {
  assert.equal(passwordMatches("s3cret", "s3cret"), true);
  assert.equal(passwordMatches("s3cre", "s3cret"), false);
  assert.equal(passwordMatches("s3cret ", "s3cret"), false);
  assert.equal(passwordMatches("", ""), false);
  assert.equal(passwordMatches("x", undefined), false);
  assert.equal(passwordMatches(null, "s3cret"), false);
});

function fakeProxyReq(authorization, extra = {}) {
  const headers = { ...extra, ...(authorization === undefined ? {} : { authorization }) };
  return {
    headers,
    getHeader: (name) => headers[name],
    setHeader: (name, value) => (headers[name] = value),
    removeHeader: (name) => delete headers[name],
  };
}

const fakeReq = (headers, remoteAddress = "10.0.0.5") => ({ headers, socket: { remoteAddress } });

test("clientAddress trusts only the edge-appended XFF entry and never loopback", () => {
  assert.equal(clientAddress(fakeReq({ "x-forwarded-for": "1.2.3.4, 203.0.113.7" })), "203.0.113.7");
  assert.equal(clientAddress(fakeReq({ "x-forwarded-for": "203.0.113.7, 127.0.0.1" })), "10.0.0.5");
  assert.equal(clientAddress(fakeReq({ "x-forwarded-for": "::1" })), "10.0.0.5");
  assert.equal(clientAddress(fakeReq({ "x-forwarded-for": "not-an-ip" })), "10.0.0.5");
  assert.equal(clientAddress(fakeReq({}, "::ffff:10.1.2.3")), "10.1.2.3");
});

test("setForwardedHeaders rebuilds forwarded headers instead of passing client values", () => {
  const proxyReq = fakeProxyReq(undefined, {
    forwarded: "for=127.0.0.1",
    "x-real-ip": "127.0.0.1",
    "x-forwarded-for": "127.0.0.1, 203.0.113.7",
    "x-forwarded-port": "1",
  });
  const req = fakeReq({ host: "hq.up.railway.app", "x-forwarded-for": "127.0.0.1, 203.0.113.7", "x-forwarded-proto": "https" });
  setForwardedHeaders(proxyReq, req);
  assert.deepEqual(proxyReq.headers, {
    "x-forwarded-for": "203.0.113.7",
    "x-forwarded-proto": "https",
    "x-forwarded-host": "hq.up.railway.app",
  });
});

test("origin checks allow the public origin and non-browser clients only", () => {
  const allowed = allowedOriginsFor(fakeReq({ host: "ignored.example" }), "https://hq.up.railway.app");
  assert.deepEqual(allowed, ["https://hq.up.railway.app"]);
  assert.equal(isAllowedOrigin("https://hq.up.railway.app", allowed), true);
  assert.equal(isAllowedOrigin("https://evil.example", allowed), false);
  assert.equal(isAllowedOrigin("null", allowed), false);
  assert.equal(isAllowedOrigin(undefined, allowed), true);
  assert.deepEqual(allowedOriginsFor(fakeReq({ host: "Local:8080" }), null), ["https://local:8080", "http://local:8080"]);
});

test("isSameOriginRequest rejects cross-site form/fetch requests (CSRF)", () => {
  const allowed = ["https://hq.up.railway.app"];
  assert.equal(isSameOriginRequest(fakeReq({ "sec-fetch-site": "same-origin", origin: "https://hq.up.railway.app" }), allowed), true);
  assert.equal(isSameOriginRequest(fakeReq({}), allowed), true);
  assert.equal(isSameOriginRequest(fakeReq({ "sec-fetch-site": "cross-site" }), allowed), false);
  assert.equal(isSameOriginRequest(fakeReq({ "sec-fetch-site": "same-site" }), allowed), false);
  assert.equal(isSameOriginRequest(fakeReq({ origin: "https://evil.example" }), allowed), false);
});

test("createFailureLimiter blocks after maxFailures per key and expires", () => {
  let t = 0;
  const limiter = createFailureLimiter({ maxFailures: 3, windowMs: 1000, now: () => t });
  for (let i = 0; i < 3; i++) limiter.recordFailure("a");
  assert.equal(limiter.isBlocked("a"), true);
  assert.equal(limiter.isBlocked("b"), false);
  t = 1001;
  assert.equal(limiter.isBlocked("a"), false);
  limiter.recordFailure("b");
  limiter.reset("b");
  assert.equal(limiter.isBlocked("b"), false);
});

test("stripBasicAuthorization drops the dashboard password but keeps Bearer tokens", () => {
  const withBasic = fakeProxyReq(basic("any:s3cret"));
  stripBasicAuthorization(withBasic);
  assert.equal(withBasic.headers.authorization, undefined);

  const withBearer = fakeProxyReq("Bearer hook-token");
  stripBasicAuthorization(withBearer);
  assert.equal(withBearer.headers.authorization, "Bearer hook-token");

  const without = fakeProxyReq(undefined);
  stripBasicAuthorization(without);
  assert.equal(without.headers.authorization, undefined);
});

test("isSafeCliArg rejects flag injection and shell-ish input", () => {
  assert.equal(isSafeCliArg("abc123"), true);
  assert.equal(isSafeCliArg("req_123-ABC"), true);
  assert.equal(isSafeCliArg("--help"), false);
  assert.equal(isSafeCliArg("-x"), false);
  assert.equal(isSafeCliArg("abc def"), false);
  assert.equal(isSafeCliArg("../../etc/passwd"), false);
  assert.equal(isSafeCliArg(""), false);
  assert.equal(isSafeCliArg(123), false);
});

test("resolvePublicOrigin prefers OPENCLAW_PUBLIC_ORIGIN, then RAILWAY_PUBLIC_DOMAIN", () => {
  assert.equal(
    resolvePublicOrigin({ OPENCLAW_PUBLIC_ORIGIN: "https://hq.example.com/path", RAILWAY_PUBLIC_DOMAIN: "x.up.railway.app" }),
    "https://hq.example.com",
  );
  assert.equal(resolvePublicOrigin({ RAILWAY_PUBLIC_DOMAIN: "My-App.up.railway.app" }), "https://my-app.up.railway.app");
  assert.equal(resolvePublicOrigin({}), null);
  assert.equal(resolvePublicOrigin({ OPENCLAW_PUBLIC_ORIGIN: "not a url" }), null);
  assert.equal(resolvePublicOrigin({ OPENCLAW_PUBLIC_ORIGIN: "javascript:alert(1)" }), null);
  assert.equal(resolvePublicOrigin({ RAILWAY_PUBLIC_DOMAIN: "evil.com/path" }), null);
  assert.equal(resolvePublicOrigin({ RAILWAY_PUBLIC_DOMAIN: "localhost" }), null);
});
