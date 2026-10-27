// @vitest-environment node
/** Which client address login attempts are counted against (src/server/auth/client-address.server.ts). */
import { describe, expect, it } from "vitest";
import {
  isCloudflareWorkers,
  isIpAddress,
  loginClientAddress,
} from "@/server/auth/client-address.server";

const SOCKET = "203.0.113.7";
const SPOOFED = "198.51.100.77";

describe("login client address", () => {
  it("off Cloudflare Workers: the socket address; a spoofed CF-Connecting-IP is ignored", () => {
    expect(loginClientAddress({ socketIp: SOCKET, cfConnectingIp: SPOOFED }, false)).toBe(SOCKET);
    expect(loginClientAddress({ socketIp: undefined, cfConnectingIp: SPOOFED }, false)).toBe(
      undefined,
    );
  });

  it("on Cloudflare Workers: CF-Connecting-IP only (there is no socket address there)", () => {
    expect(loginClientAddress({ socketIp: SOCKET, cfConnectingIp: SPOOFED }, true)).toBe(SPOOFED);
    expect(loginClientAddress({ socketIp: SOCKET, cfConnectingIp: undefined }, true)).toBe(
      undefined,
    );
    expect(loginClientAddress({ socketIp: undefined, cfConnectingIp: " 2001:db8::1 " }, true)).toBe(
      "2001:db8::1",
    );
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
      expect(loginClientAddress({ socketIp: bad, cfConnectingIp: undefined }, false)).toBe(
        undefined,
      );
      expect(loginClientAddress({ socketIp: undefined, cfConnectingIp: bad }, true)).toBe(
        undefined,
      );
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

  it("detects Cloudflare Workers by the runtime's user agent only", () => {
    // Vitest runs under Node.js, whose navigator.userAgent is "Node.js/<version>".
    expect(isCloudflareWorkers()).toBe(false);
    const original = Object.getOwnPropertyDescriptor(globalThis, "navigator");
    try {
      Object.defineProperty(globalThis, "navigator", {
        value: { userAgent: "Cloudflare-Workers" },
        configurable: true,
      });
      expect(isCloudflareWorkers()).toBe(true);
      expect(loginClientAddress({ socketIp: SOCKET, cfConnectingIp: SPOOFED })).toBe(SPOOFED);
      Object.defineProperty(globalThis, "navigator", { value: undefined, configurable: true });
      expect(isCloudflareWorkers()).toBe(false);
      expect(loginClientAddress({ socketIp: SOCKET, cfConnectingIp: SPOOFED })).toBe(SOCKET);
    } finally {
      if (original) Object.defineProperty(globalThis, "navigator", original);
    }
  });
});
