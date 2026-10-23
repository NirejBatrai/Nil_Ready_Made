/**
 * Nitro server-bundle settings, merged with those from @lovable.dev/vite-tanstack-config.
 *
 * MongoDB's URL parser (mongodb-connection-string-url → whatwg-url → tr46) does
 * `require("punycode/")`. The trailing slash deliberately asks for the npm `punycode` package
 * instead of Node's deprecated built-in, but Nitro's Cloudflare build aliases `punycode` to an
 * unenv polyfill file, and the slash then makes that path invalid ("Not a directory").
 * Point exactly `punycode/` at the npm package that tr46 depends on.
 */
import { fileURLToPath } from "node:url";
import { defineConfig } from "nitro/config";

export default defineConfig({
  alias: {
    "punycode/": fileURLToPath(new URL("./node_modules/punycode/punycode.js", import.meta.url)),
  },
});
