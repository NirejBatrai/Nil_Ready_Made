// @vitest-environment node
/**
 * DEMO_ENABLED (src/server/demo-setting.server.ts): OFF by default in production builds, ON in
 * dev and tests, "true"/"false" override, unreadable environment → OFF. The start page and the
 * redirects themselves are covered by the E2E suite (dev server = ON, built server = OFF / ON).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { demoEnabledFrom, readDemoEnabled } from "@/server/demo-setting.server";

describe("DEMO_ENABLED", () => {
  it('production builds: OFF unless DEMO_ENABLED is exactly "true"', () => {
    for (const value of [undefined, "", "1", "yes", "TRUE", " true", "on", "false"])
      expect(demoEnabledFrom(value, true), String(value)).toBe(false);
    expect(demoEnabledFrom("true", true)).toBe(true);
    expect(readDemoEnabled(() => ({}), true)).toBe(false);
    expect(readDemoEnabled(() => ({ DEMO_ENABLED: "true" }), true)).toBe(true);
  });

  it('dev and tests: ON unless DEMO_ENABLED is exactly "false"', () => {
    for (const value of [undefined, "", "true", "0", "no"])
      expect(demoEnabledFrom(value, false), String(value)).toBe(true);
    expect(demoEnabledFrom("false", false)).toBe(false);
    // This test run itself is not a production build, so the default is ON.
    expect(import.meta.env.PROD).toBe(false);
    expect(readDemoEnabled(() => ({}))).toBe(true);
  });

  it("an unreadable environment fails safe to OFF, in dev too", () => {
    const unreadable = () => {
      throw new Error("no process.env here");
    };
    expect(readDemoEnabled(unreadable, false)).toBe(false);
    expect(readDemoEnabled(unreadable, true)).toBe(false);
  });

  it("the server function runs safeErrors; the guards treat any failure as OFF (source check)", () => {
    const source = readFileSync("src/lib/demo.ts", "utf8");
    expect(source).toMatch(
      /createServerFn\(\{ method: "GET" \}\)\s*\.middleware\(\[safeErrors\]\)/,
    );
    expect(source).toMatch(/catch \{\s*return false;\s*\}/);
    expect(readFileSync("src/routes/_shell.tsx", "utf8")).toMatch(/await requireDemo\(\);/);
    expect(readFileSync("src/routes/index.tsx", "utf8")).toMatch(/demoEnabled: await demoIsOn\(\)/);
  });
});
