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
 */
import { fileURLToPath } from "node:url";
import { defineConfig } from "nitro/config";
import { BASELINE_SECURITY_HEADERS } from "./src/server/security-headers.server";

export default defineConfig({
  routeRules: { "/**": { headers: { ...BASELINE_SECURITY_HEADERS } } },
  alias: {
    "punycode/": fileURLToPath(new URL("./node_modules/punycode/punycode.js", import.meta.url)),
  },
});
