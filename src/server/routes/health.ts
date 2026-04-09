/**
 * T019: Health API routes
 * GET /health — server health + dependency statuses
 * POST /health/refresh — re-run all dependency health checks
 */

import { FastifyInstance, FastifyPluginCallback, FastifyReply, FastifyRequest } from 'fastify';
import { ok, fail } from '../utils/envelope';

// The health checker is built in parallel (T016) — import from expected path
import type { HealthChecker, HealthReport } from '../health/checker';
// Job manager is needed for active/queued job counts
import type { JobManager } from '../jobs/manager';

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

export interface HealthRouteOptions {
  healthChecker: HealthChecker;
  jobManager: JobManager;
}

const serverStartTime = Date.now();

const healthRoutes: FastifyPluginCallback<HealthRouteOptions> = (
  fastify: FastifyInstance,
  opts: HealthRouteOptions,
  done
) => {
  const { healthChecker, jobManager } = opts;

  // -----------------------------------------------------------------------
  // GET /health — return server health summary
  // -----------------------------------------------------------------------
  fastify.get('/health', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      const report = await healthChecker.getReport();

      // Compute active/queued job counts from the job manager
      let activeJobs = 0;
      let queuedJobs = 0;
      try {
        const allJobs = await jobManager.listJobs({});
        for (const job of allJobs) {
          if (job.status === 'running') activeJobs++;
          if (job.status === 'queued') queuedJobs++;
        }
      } catch {
        // Job listing might fail if the persistence directory is missing — non-fatal
      }

      const uptimeMs = Date.now() - serverStartTime;

      return ok(
        'health',
        {
          status: report.healthy ? 'ok' : 'degraded',
          uptime: uptimeMs,
          uptimeHuman: formatUptime(uptimeMs),
          dependencies: report.dependencies,
          jobs: {
            active: activeJobs,
            queued: queuedJobs,
          },
          checkedAt: report.checkedAt,
        },
        reply
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return fail('health', 'HEALTH_CHECK_FAILED', message, reply, 500);
    }
  });

  // -----------------------------------------------------------------------
  // POST /health/refresh — force re-run of all dependency checks
  // -----------------------------------------------------------------------
  fastify.post('/health/refresh', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      const report = await healthChecker.refresh();

      return ok(
        'health.refresh',
        {
          status: report.healthy ? 'ok' : 'degraded',
          dependencies: report.dependencies,
          checkedAt: report.checkedAt,
        },
        reply
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return fail('health.refresh', 'HEALTH_REFRESH_FAILED', message, reply, 500);
    }
  });

  done();
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatUptime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ${hours % 24}h ${minutes % 60}m`;
  if (hours > 0) return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

export default healthRoutes;
