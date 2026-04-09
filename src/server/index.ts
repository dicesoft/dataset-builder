/**
 * T009: Fastify server entry point
 * Web dashboard server for the dataset-builder CLI tool
 */

import fs from 'fs';
import path from 'path';
import Fastify, { FastifyInstance } from 'fastify';
import fastifyCors from '@fastify/cors';
import fastifyWebsocket from '@fastify/websocket';
import { checkBundleFreshness } from './bundleCheck';
import errorHandler from './middleware/errors';
import rateLimitPlugin from './middleware/rateLimit';
import staticPlugin from './middleware/static';
import wsProgress from './ws/progress';
import { getJobManager } from './jobs/manager';
import { HealthChecker } from './health/checker';
import datasetsRoutes from './routes/datasets';
import uploadRoutes from './routes/upload';
import { cleanupTempFiles } from './routes/upload';
import jobsRoutes from './routes/jobs';
import healthRoutes from './routes/health';
import configRoutes from './routes/config';
import commandsRoutes from './routes/commands';
import metadataRoutes from './routes/metadata';

// Environment configuration
const HOST = process.env.HOST || '127.0.0.1';
const PORT = parseInt(process.env.PORT || '3000', 10);
const LOG_LEVEL = process.env.LOG_LEVEL || 'info';

/**
 * Build info written by `scripts/write-build-info.ts` during `npm run build`.
 * Consumed by the startup banner and by the Phase 4.6 bundle-freshness check.
 * Tolerates the file being missing (dev mode / tarball installs).
 */
export interface BuildInfo {
  gitSha: string;
  builtAt: string;
}

export function readBuildInfo(): BuildInfo {
  const fallback: BuildInfo = { gitSha: 'unknown', builtAt: 'unknown' };
  try {
    const infoPath = path.resolve(__dirname, 'build-info.json');
    const raw = fs.readFileSync(infoPath, 'utf8');
    const parsed = JSON.parse(raw) as Partial<BuildInfo>;
    return {
      gitSha: typeof parsed.gitSha === 'string' ? parsed.gitSha : fallback.gitSha,
      builtAt: typeof parsed.builtAt === 'string' ? parsed.builtAt : fallback.builtAt,
    };
  } catch {
    return fallback;
  }
}

/**
 * Create and configure the Fastify server instance
 */
export async function buildServer(): Promise<FastifyInstance> {
  const fastify = Fastify({
    logger: {
      level: LOG_LEVEL,
    },
  });

  // Register CORS — permissive for local dev, restrictive otherwise
  const isLocal = HOST === '127.0.0.1' || HOST === 'localhost';
  const corsOrigin = isLocal ? true : process.env.CORS_ORIGIN || false;
  await fastify.register(fastifyCors, {
    origin: corsOrigin,
  });

  // Register WebSocket support
  await fastify.register(fastifyWebsocket);

  // Register error handler
  await fastify.register(errorHandler);

  // Register rate limiting
  await fastify.register(rateLimitPlugin);

  // Create shared dependencies for route plugins
  const jobManager = getJobManager();
  const healthChecker = new HealthChecker();

  // Register API routes under /api/v1 prefix
  await fastify.register(
    async (api) => {
      // API routes will be registered here by route modules
      // For now, a basic health endpoint
      api.get('/ping', async () => {
        return { version: 1, success: true, command: 'ping', data: { pong: true } };
      });

      // Dataset browsing and media serving routes (T046, T047)
      await api.register(datasetsRoutes);

      // File upload route (T065)
      await api.register(uploadRoutes);

      // Jobs API (T018)
      await api.register(jobsRoutes, { jobManager });

      // Health API (T019)
      await api.register(healthRoutes, { healthChecker, jobManager });

      // Config API (T020)
      await api.register(configRoutes);

      // Command metadata API (T021)
      await api.register(commandsRoutes);

      // Metadata API (T022)
      await api.register(metadataRoutes);
    },
    { prefix: '/api/v1' }
  );

  // Register WebSocket progress multiplexer (needs to be at root level for /api/v1/ws)
  await fastify.register(wsProgress);

  // Register static file serving (SPA fallback) - must be last
  await fastify.register(staticPlugin);

  return fastify;
}

/**
 * Start the server
 */
export async function startServer(): Promise<FastifyInstance> {
  const fastify = await buildServer();

  // T078: Recover jobs that were running/queued when the server last stopped
  const manager = getJobManager();
  const recovered = await manager.recoverInterruptedJobs();
  if (recovered > 0) {
    fastify.log.info(`Recovered ${recovered} interrupted job(s) from previous session`);
  }

  // Graceful shutdown handler
  const shutdown = async (signal: string) => {
    fastify.log.info(`Received ${signal}, shutting down gracefully...`);

    // Mark running jobs as interrupted
    const manager = getJobManager();
    await manager.shutdown();

    // Close the server
    await fastify.close();
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  // Schedule periodic temp file cleanup (every 30 minutes)
  const cleanupInterval = setInterval(
    async () => {
      try {
        const cleaned = await cleanupTempFiles();
        if (cleaned > 0) {
          fastify.log.info(`Cleaned up ${cleaned} stale temp upload file(s)`);
        }
      } catch {
        // Best-effort cleanup
      }
    },
    30 * 60 * 1000
  );
  cleanupInterval.unref();

  // Run initial cleanup on startup
  cleanupTempFiles().catch(() => {});

  // Start listening
  try {
    await fastify.listen({ host: HOST, port: PORT });
    const { gitSha, builtAt } = readBuildInfo();
    fastify.log.info(`[server] dataset-builder ${gitSha} built ${builtAt}, listening on :${PORT}`);
    // Phase 4.6: warn if the dashboard bundle is stale vs the server bundle.
    // Best-effort — never throws, never blocks boot.
    checkBundleFreshness();
  } catch (err: unknown) {
    if (
      err &&
      typeof err === 'object' &&
      'code' in err &&
      (err as NodeJS.ErrnoException).code === 'EADDRINUSE'
    ) {
      fastify.log.error(
        `Port ${PORT} is already in use. Another instance of dataset-builder may be running. ` +
          `Stop the other instance or use a different port: PORT=${PORT + 1} npm run start:web`
      );
      process.exit(1);
    }
    throw err;
  }

  return fastify;
}

// Auto-start if run directly
const isDirectRun =
  require.main === module ||
  process.argv[1]?.endsWith('server/index.js') ||
  process.argv[1]?.endsWith('server\\index.js');

if (isDirectRun) {
  startServer().catch((err) => {
    console.error('Failed to start server:', err);
    process.exit(1);
  });
}
