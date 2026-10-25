// @vitest-environment node
/**
 * Baseline security headers: the pure function, HSTS gating, every return path of src/server.ts,
 * and public/_headers (static files) staying in sync with the server constants.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  applySecurityHeaders,
  BASELINE_SECURITY_HEADERS,
  HSTS_MAX_AGE_LIMIT,
  parseHstsMaxAge,
  securityHeaderOptions,
} from "@/server/security-headers.server";

const entryFetch = vi.fn<(request: Request) => Promise<Response>>();
vi.mock("@tanstack/react-start/server-entry", () => ({ default: { fetch: entryFetch } }));

const DEV = { production: false, hstsMaxAge: undefined };
const PROD_HSTS = { production: true, hstsMaxAge: 300 };
const req = (path: string, origin = "http://127.0.0.1:3000") => new Request(`${origin}${path}`);

// Written out independently of the constant, so a header removed from it is caught here.
const EXPECTED = {
  "X-Frame-Options": "DENY",
  "Content-Security-Policy": "frame-ancestors 'none'",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy":
    "accelerometer=(), autoplay=(), bluetooth=(), camera=(), display-capture=(), geolocation=(), " +
    "gyroscope=(), hid=(), magnetometer=(), microphone=(), midi=(), payment=(), serial=(), " +
    "usb=(), xr-spatial-tracking=()",
};

function expectBaseline(res: Response) {
  for (const [name, value] of Object.entries(EXPECTED))
    expect(res.headers.get(name), name).toBe(value);
}

describe("applySecurityHeaders", () => {
  it("sets the baseline and no-store on a page, keeping body, status and statusText", async () => {
    const original = new Response("<p>hi</p>", {
      status: 404,
      statusText: "Not Found",
      headers: { "content-type": "text/html; charset=utf-8" },
    });
    const res = applySecurityHeaders(req("/nope"), original, DEV);
    expectBaseline(res);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(res.status).toBe(404);
    expect(res.statusText).toBe("Not Found");
    expect(await res.text()).toBe("<p>hi</p>");
  });

  it("replaces weaker values instead of adding duplicates", () => {
    const original = new Response("x", {
      headers: { "X-Frame-Options": "SAMEORIGIN", "Cache-Control": "public, max-age=600" },
    });
    const res = applySecurityHeaders(req("/owner/products"), original, DEV);
    expect(res.headers.get("x-frame-options")).toBe("DENY");
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("works on redirects, whose headers are immutable, and keeps status and Location", () => {
    const original = Response.redirect("http://127.0.0.1:3000/login?redirect=x", 307);
    expect(() => original.headers.set("X-Frame-Options", "DENY")).toThrow();
    const res = applySecurityHeaders(req("/owner/products"), original, DEV);
    expectBaseline(res);
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("http://127.0.0.1:3000/login?redirect=x");
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("keeps every Set-Cookie header", () => {
    const headers = new Headers();
    headers.append("Set-Cookie", "a=1; Path=/; HttpOnly");
    headers.append("Set-Cookie", "b=2; Path=/; HttpOnly");
    const res = applySecurityHeaders(req("/_serverFn/x"), new Response("{}", { headers }), DEV);
    expect(res.headers.getSetCookie()).toEqual(["a=1; Path=/; HttpOnly", "b=2; Path=/; HttpOnly"]);
  });

  it("passes a streamed body through intact", async () => {
    const parts = ["<html>", "streamed", "</html>"];
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        for (const p of parts) c.enqueue(new TextEncoder().encode(p));
        c.close();
      },
    });
    const res = applySecurityHeaders(req("/"), new Response(stream), DEV);
    expect(await res.text()).toBe(parts.join(""));
  });

  it("keeps the caching of hashed build assets but still adds the baseline", () => {
    const cache = "public, max-age=31536000, immutable";
    const res = applySecurityHeaders(
      req("/assets/index-abc123.js"),
      new Response("x", { headers: { "Cache-Control": cache } }),
      DEV,
    );
    expect(res.headers.get("cache-control")).toBe(cache);
    expectBaseline(res);
    // Without its own caching an /assets path is not special.
    const bare = applySecurityHeaders(req("/assets/x.js"), new Response("x"), DEV);
    expect(bare.headers.get("cache-control")).toBe("no-store");
  });

  it("no-store does not depend on path spelling (owner data in any case or encoding)", () => {
    for (const path of ["/OWNER/products", "/%6Fwner/products", "/_serverFn/abc", "/login"])
      expect(
        applySecurityHeaders(req(path), new Response("x"), DEV).headers.get("cache-control"),
      ).toBe("no-store");
  });
});

describe("HSTS", () => {
  const hsts = (path: string, origin: string, opts: Parameters<typeof applySecurityHeaders>[2]) =>
    applySecurityHeaders(req(path, origin), new Response("x"), opts).headers.get(
      "strict-transport-security",
    );

  it("is sent only for a production build, an https request and a configured max-age", () => {
    expect(hsts("/", "https://shop.example", PROD_HSTS)).toBe("max-age=300");
    expect(hsts("/", "http://shop.example", PROD_HSTS)).toBeNull();
    expect(hsts("/", "https://shop.example", { production: false, hstsMaxAge: 300 })).toBeNull();
    expect(hsts("/", "https://shop.example", { production: true, hstsMaxAge: undefined })).toBe(
      null,
    );
  });

  it("an HSTS header from further down is removed when HSTS is off", () => {
    const res = applySecurityHeaders(
      req("/"),
      new Response("x", { headers: { "Strict-Transport-Security": "max-age=63072000" } }),
      DEV,
    );
    expect(res.headers.get("strict-transport-security")).toBeNull();
  });

  it.each([
    [undefined, undefined],
    ["", undefined],
    ["0", undefined],
    ["-1", undefined],
    ["abc", undefined],
    ["1e9", undefined],
    ["300.5", undefined],
    ["0300", undefined],
    [String(HSTS_MAX_AGE_LIMIT + 1), undefined],
    ["300", 300],
    [" 86400 ", 86400],
    [String(HSTS_MAX_AGE_LIMIT), HSTS_MAX_AGE_LIMIT],
  ])("SECURITY_HSTS_MAX_AGE=%j parses to %j", (value, expected) => {
    expect(parseHstsMaxAge(value)).toBe(expected);
  });

  describe("securityHeaderOptions", () => {
    afterEach(() => vi.unstubAllEnvs());

    it("reads SECURITY_HSTS_MAX_AGE at call time; tests are not a production build", () => {
      vi.stubEnv("SECURITY_HSTS_MAX_AGE", "300");
      expect(securityHeaderOptions()).toEqual({ production: false, hstsMaxAge: 300 });
      vi.stubEnv("SECURITY_HSTS_MAX_AGE", "not-a-number");
      expect(securityHeaderOptions().hstsMaxAge).toBeUndefined();
    });

    it("never throws: an unreadable environment keeps HSTS off", () => {
      const missing = () => {
        throw new ReferenceError("process is not defined");
      };
      expect(securityHeaderOptions(missing)).toEqual({ production: false, hstsMaxAge: undefined });
    });
  });
});

describe("src/server.ts: every return path is secured", () => {
  beforeEach(() => {
    entryFetch.mockReset();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  const serve = async (path: string) => {
    const { default: server } = await import("@/server");
    return server.fetch(req(path), {}, {});
  };

  it("normal responses", async () => {
    entryFetch.mockResolvedValue(new Response("ok", { headers: { "content-type": "text/html" } }));
    const res = await serve("/");
    expectBaseline(res);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.text()).toBe("ok");
  });

  it("redirects from route guards", async () => {
    entryFetch.mockResolvedValue(Response.redirect("http://127.0.0.1:3000/login", 307));
    const res = await serve("/owner/products");
    expectBaseline(res);
    expect(res.status).toBe(307);
  });

  it("a thrown error becomes the HTML error page with the headers", async () => {
    entryFetch.mockRejectedValue(new Error("boom"));
    const res = await serve("/");
    expect(res.status).toBe(500);
    expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expectBaseline(res);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("an h3-swallowed 500 is replaced by the HTML error page with the headers", async () => {
    entryFetch.mockResolvedValue(
      new Response(JSON.stringify({ unhandled: true, message: "HTTPError" }), {
        status: 500,
        headers: { "content-type": "application/json" },
      }),
    );
    const res = await serve("/");
    expect(res.status).toBe(500);
    expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expectBaseline(res);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
});

describe("public/_headers (static files)", () => {
  const file = readFileSync(join(process.cwd(), "public/_headers"), "utf8");
  const lines = file.split("\n").filter((l) => l.trim() && !l.trim().startsWith("#"));

  it("has one /* rule with exactly the baseline headers, and no caching or HSTS", () => {
    expect(lines[0]).toBe("/*");
    const rules = lines.slice(1).map((l) => {
      expect(l).toMatch(/^ {2}\S/);
      const i = l.indexOf(":");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    });
    expect(Object.fromEntries(rules)).toEqual(BASELINE_SECURITY_HEADERS);
    expect(Object.fromEntries(rules)).toEqual(EXPECTED);
    expect(rules).toHaveLength(Object.keys(BASELINE_SECURITY_HEADERS).length);
    expect(lines.join("\n")).not.toMatch(/cache-control|strict-transport-security/i);
  });
});
