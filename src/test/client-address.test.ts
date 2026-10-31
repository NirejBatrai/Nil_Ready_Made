// @vitest-environment node
/** Which client address login attempts are counted against (src/server/auth/client-address.server.ts). */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  currentPlatform,
  isCloudflareWorkers,
  isIpAddress,
  isVercel,
  loginClientAddress,
} from "@/server/auth/client-address.server";

const SOCKET = "203.0.113.7";
const SPOOFED = "198.51.100.77";
const VERCEL_CLIENT = "192.0.2.44";
/** What a client could send itself: every proxy header set to someone else's address. */
const spoofed = (socketIp: string | null = SOCKET) => ({
  socketIp: socketIp ?? undefined,
  cfConnectingIp: SPOOFED,
  vercelForwardedFor: SPOOFED,
});

afterEach(() => vi.unstubAllEnvs());

describe("login client address", () => {
  it("on a plain server (off Vercel, off Workers): the socket address; every header is ignored", () => {
    expect(loginClientAddress(spoofed(), "server")).toBe(SOCKET);
    expect(loginClientAddress(spoofed(null), "server")).toBe(undefined);
    // X-Forwarded-For is never even read (getRequestIP() without options; see session-context).
  });

  it("on Vercel (simulated): the first entry of x-vercel-forwarded-for only, never the socket", () => {
    const vercel = (value: string | undefined) =>
      loginClientAddress(
        { socketIp: SOCKET, cfConnectingIp: SPOOFED, vercelForwardedFor: value },
        "vercel",
      );
    expect(vercel(VERCEL_CLIENT)).toBe(VERCEL_CLIENT);
    expect(vercel(` ${VERCEL_CLIENT} , 10.0.0.1`)).toBe(VERCEL_CLIENT);
    expect(vercel(" 2001:db8::7 ")).toBe("2001:db8::7");
    // Missing or invalid first entry: no address (later entries are never consulted).
    for (const bad of [undefined, "", "unknown", "unknown, 192.0.2.1", ", 192.0.2.1", "1.2.3"])
      expect(vercel(bad), String(bad)).toBe(undefined);
  });

  it("on Cloudflare Workers: CF-Connecting-IP only (there is no socket address there)", () => {
    const workers = (cfConnectingIp: string | undefined) =>
      loginClientAddress(
        { socketIp: SOCKET, cfConnectingIp, vercelForwardedFor: VERCEL_CLIENT },
        "workers",
      );
    expect(workers(SPOOFED)).toBe(SPOOFED);
    expect(workers(undefined)).toBe(undefined);
    expect(workers(" 2001:db8::1 ")).toBe("2001:db8::1");
  });

  it("anything that is not an IP address gives undefined, never a shared key", () => {
    for (const bad of [
      "",
      "  ",
      "unknown",
      "localhost",
      "1.2.3",
      "256.1.1.1",
      "1.2.3.4, 5.6.7.8",
    ]) {
      const none = {
        socketIp: undefined,
        cfConnectingIp: undefined,
        vercelForwardedFor: undefined,
      };
      expect(loginClientAddress({ ...none, socketIp: bad }, "server")).toBe(undefined);
      expect(loginClientAddress({ ...none, cfConnectingIp: bad }, "workers")).toBe(undefined);
    }
  });

  it("recognizes IPv4 and IPv6 addresses (including mapped and zoned) and rejects the rest", () => {
    for (const ok of ["127.0.0.1", "0.0.0.0", "255.255.255.255", "::1", "2001:db8::1"])
      expect(isIpAddress(ok)).toBe(true);
    for (const ok of ["::ffff:203.0.113.7", "fe80::1%eth0", "2001:0db8:0:0:0:0:0:1"])
      expect(isIpAddress(ok)).toBe(true);
    for (const bad of ["1::2::3", "zz::1", "01.2.3.4", "1.2.3.4.5", ":", "[::1]", "a".repeat(46)])
      expect(isIpAddress(bad)).toBe(false);
    expect(isIpAddress(`1:${"0:".repeat(30)}1`)).toBe(false);
  });

  it("detects Vercel by the runtime's VERCEL=1 environment variable only", () => {
    vi.stubEnv("VERCEL", "");
    expect(isVercel()).toBe(false);
    expect(currentPlatform()).toBe("server");
    expect(loginClientAddress(spoofed())).toBe(SOCKET);
    for (const value of ["0", "true", "yes", " 1"]) {
      vi.stubEnv("VERCEL", value);
      expect(isVercel(), value).toBe(false);
    }
    vi.stubEnv("VERCEL", "1");
    expect(isVercel()).toBe(true);
    expect(currentPlatform()).toBe("vercel");
    expect(
      loginClientAddress({
        socketIp: SOCKET,
        cfConnectingIp: SPOOFED,
        vercelForwardedFor: VERCEL_CLIENT,
      }),
    ).toBe(VERCEL_CLIENT);
  });

  it("detects Cloudflare Workers by the runtime's user agent only", () => {
    vi.stubEnv("VERCEL", "");
    // Vitest runs under Node.js, whose navigator.userAgent is "Node.js/<version>".
    expect(isCloudflareWorkers()).toBe(false);
    const original = Object.getOwnPropertyDescriptor(globalThis, "navigator");
    try {
      Object.defineProperty(globalThis, "navigator", {
        value: { userAgent: "Cloudflare-Workers" },
        configurable: true,
      });
      expect(isCloudflareWorkers()).toBe(true);
      expect(loginClientAddress(spoofed())).toBe(SPOOFED);
      Object.defineProperty(globalThis, "navigator", { value: undefined, configurable: true });
      expect(isCloudflareWorkers()).toBe(false);
      expect(loginClientAddress(spoofed())).toBe(SOCKET);
    } finally {
      if (original) Object.defineProperty(globalThis, "navigator", original);
    }
  });
});
