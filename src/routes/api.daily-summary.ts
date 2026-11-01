/**
 * `GET /api/daily-summary?date=YYYY-MM-DD` for n8n (INTERIM Quick Sales, decision 0004).
 * Bearer token only (`SUMMARY_API_TOKEN`); no cookies or sessions. All logic, including the
 * fail-closed token check and the rate limit, is in src/server/summary-api.server.ts.
 */
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/daily-summary")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { dailySummaryFromRequest } = await import("@/server/summary-api.server");
        return dailySummaryFromRequest(request);
      },
    },
  },
});
