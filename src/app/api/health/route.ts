import { checkHealth } from "~/server/health";

/**
 * Railway deploy healthcheck for the web service (railway/web.json → healthcheckPath).
 * GET route handlers are dynamic by default since Next 15 — never cached.
 */
export async function GET() {
  const report = await checkHealth();
  return Response.json(report, {
    status: report.status === "ok" ? 200 : 503,
    headers: { "cache-control": "no-store" },
  });
}
