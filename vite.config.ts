// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { nitroPreset } from "./src/server/build-preset.server";

export default defineConfig({
  // Production runs as a Node.js server, not on Cloudflare Workers (the Lovable default).
  // See docs/decisions/0001-runtime-node-not-workers.md. Start the build with
  // `node .output/server/index.mjs`. A Vercel build (NITRO_PRESET=vercel, or VERCEL=1 set by
  // Vercel) writes .vercel/output instead: personal testing only, decision 0003.
  nitro: { preset: nitroPreset(process.env) },
  vite: {
    // Local development only: listen on this computer, not the local network. The Lovable
    // default is "::" (all interfaces), which would expose server functions to other devices.
    server: { host: "127.0.0.1" },
  },
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
});
