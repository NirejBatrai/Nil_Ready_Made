/**
 * BUILD-TIME ONLY (read by vite.config.ts): which Nitro preset the server bundle is built for.
 *
 * - Default: `node-server` (decision 0001), started with `node .output/server/index.mjs`.
 * - `vercel` (decision 0003, personal testing only): writes Vercel's Build Output API folder
 *   `.vercel/output`. Chosen by `NITRO_PRESET=vercel`, or automatically when Vercel builds the
 *   project (Vercel sets `VERCEL=1` in its build environment).
 * - Any other `NITRO_PRESET` value fails the build instead of silently producing something
 *   untested.
 */
export const NITRO_PRESETS = ["node-server", "vercel"] as const;
export type NitroPreset = (typeof NITRO_PRESETS)[number];

const isPreset = (v: string): v is NitroPreset => NITRO_PRESETS.some((p) => p === v);

export function nitroPreset(env: Record<string, string | undefined>): NitroPreset {
  const requested = env["NITRO_PRESET"]?.trim();
  if (requested) {
    if (!isPreset(requested))
      throw new Error(
        `Unsupported NITRO_PRESET "${requested}". Use one of: ${NITRO_PRESETS.join(", ")}.`,
      );
    return requested;
  }
  return env["VERCEL"] === "1" ? "vercel" : "node-server";
}
