/**
 * Nitro server-bundle settings, merged with those from @lovable.dev/vite-tanstack-config.
 *
 * Static files: the Node server (preset `node-server`, set in vite.config.ts) serves
 * `.output/public` itself, before src/server.ts runs, so those responses never get the dynamic
 * security headers. The route rule below adds the same baseline to every response, static files
 * included. Values come from the server constants, so there is one source of truth; they are set,
 * not appended, so dynamic responses still carry each header once. No Cache-Control or HSTS here:
 * hashed `/assets/*` keep Nitro's long-lived caching and src/server.ts decides the rest.
 *
 * MongoDB's URL parser (mongodb-connection-string-url → whatwg-url → tr46) does
 * `require("punycode/")`. The trailing slash deliberately asks for the npm `punycode` package
 * instead of Node's deprecated built-in, but Nitro's Cloudflare build aliased `punycode` to an
 * unenv polyfill file, and the slash then made that path invalid ("Not a directory").
 * Point exactly `punycode/` at the npm package that tr46 depends on. Only the former Workers
 * target needed this; it is harmless for the Node server (candidate for removal).
 *
 * Vercel build (decision 0003): Vercel serves static files itself and applies the `routes` of
 * `.vercel/output/config.json`, where routing STOPS at the first matching route unless it has
 * `continue: true` (Build Output API v3). Nitro writes route-rule headers without `continue`,
 * after its own `/assets/(.*)` cache rule, so the baseline would miss hashed assets and its
 * catch-all would stop routing before the app function. For Vercel the baseline is therefore
 * emitted as the FIRST route, for every path, with `continue: true`, and not as a route rule.
 */
import { fileURLToPath } from "node:url";
import { defineConfig } from "nitro/config";
import type { NitroConfig } from "nitro/types";
import { nitroPreset, type NitroPreset } from "./src/server/build-preset.server";
import { BASELINE_SECURITY_HEADERS } from "./src/server/security-headers.server";

/** Exported for tests; the default export uses the preset this build is for. */
export function nitroSettings(preset: NitroPreset): Omit<NitroConfig, "rootDir"> {
  const alias = {
    "punycode/": fileURLToPath(new URL("./node_modules/punycode/punycode.js", import.meta.url)),
  };
  if (preset === "vercel")
    return {
      alias,
      vercel: {
        config: {
          version: 3 as const,
          routes: [{ src: "/(.*)", headers: { ...BASELINE_SECURITY_HEADERS }, continue: true }],
        },
      },
    };
  return { routeRules: { "/**": { headers: { ...BASELINE_SECURITY_HEADERS } } }, alias };
}

export default defineConfig(nitroSettings(nitroPreset(process.env)));
