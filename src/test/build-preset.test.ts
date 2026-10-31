// @vitest-environment node
/** Nitro preset selection for builds (src/server/build-preset.server.ts, used by vite.config.ts). */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { nitroPreset } from "@/server/build-preset.server";

describe("build preset", () => {
  it("defaults to the Node.js server", () => {
    expect(nitroPreset({})).toBe("node-server");
    expect(nitroPreset({ NITRO_PRESET: "", VERCEL: "0" })).toBe("node-server");
  });

  it("builds for Vercel when asked, or when Vercel itself builds (VERCEL=1)", () => {
    expect(nitroPreset({ NITRO_PRESET: "vercel" })).toBe("vercel");
    expect(nitroPreset({ NITRO_PRESET: " vercel " })).toBe("vercel");
    expect(nitroPreset({ VERCEL: "1" })).toBe("vercel");
    // An explicit choice wins over the platform.
    expect(nitroPreset({ NITRO_PRESET: "node-server", VERCEL: "1" })).toBe("node-server");
  });

  it("refuses any other preset instead of building something untested", () => {
    for (const p of ["cloudflare-module", "netlify", "VERCEL", "node"])
      expect(() => nitroPreset({ NITRO_PRESET: p })).toThrow(/Unsupported NITRO_PRESET/);
  });

  it("vite.config.ts takes the preset from this function", () => {
    expect(readFileSync("vite.config.ts", "utf8")).toMatch(
      /nitro: \{ preset: nitroPreset\(process\.env\) \}/,
    );
  });
});
