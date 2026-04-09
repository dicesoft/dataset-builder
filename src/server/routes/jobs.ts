/**
 * T018: Jobs API routes
 * POST /jobs, GET /jobs, GET /jobs/:id,
 * POST /jobs/:id/cancel, POST /jobs/:id/resume, DELETE /jobs/:id
 */

import { FastifyInstance, FastifyPluginCallback, FastifyRequest, FastifyReply } from 'fastify';
import { Command, Option } from 'commander';
import { JobStatus, CreateJobRequest, JobRecord } from '../jobs/types';
import { ok, fail } from '../utils/envelope';
import { program } from '../../cli/program';

// The job manager is built in parallel (T015) — import from expected path
import type { JobManager } from '../jobs/manager';

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

/** Allowed CLI commands that can be submitted as jobs */
const ALLOWED_COMMANDS = new Set([
  'scrape',
  'generate',
  'import',
  'export',
  'clean',
  'run',
  'config',
  'prune',
  'web-search',
  'resume',
  'compress',
  'translate',
  'format',
  'transform',
]);

/**
 * Validate job options against Commander.js command metadata choices.
 * Only validates options that have `.argChoices` defined.
 * Multi-value fields (comma-separated) have each value validated individually.
 * Returns null if valid, or a descriptive error string if invalid.
 */
function validateOptionsAgainstChoices(
  command: string,
  options: Record<string, unknown>
): string | null {
  const subcommands = (program as any).commands as Command[];
  const cmd = subcommands.find((c: Command) => c.name() === command);
  if (!cmd) return null; // Unknown command — let it pass through

  for (const opt of cmd.options as Option[]) {
    const choices: string[] | undefined = (opt as any).argChoices;
    if (!choices || choices.length === 0) continue;

    const attrName = opt.attributeName();
    const value = options[attrName];
    if (value === undefined || value === null || value === '') continue;

    const strValue = String(value);
    // Support comma-separated multi-value fields
    const values = strValue.includes(',') ? strValue.split(',').map((v) => v.trim()) : [strValue];

    for (const v of values) {
      if (!choices.includes(v)) {
        return `Invalid value '${v}' for option '--${opt.long?.replace(/^--/, '') ?? attrName}'. Valid values: ${choices.join(', ')}`;
      }
    }
  }

  return null;
}

/** Statuses that allow deletion */
const DELETABLE_STATUSES = new Set<JobStatus>([
  JobStatus.completed,
  JobStatus.failed,
  JobStatus.cancelled,
]);

/** Statuses that allow cancellation */
const CANCELLABLE_STATUSES = new Set<JobStatus>([JobStatus.queued, JobStatus.running]);

/** Statuses that allow resume */
const RESUMABLE_STATUSES = new Set<JobStatus>([JobStatus.failed, JobStatus.interrupted]);

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

export interface JobsRouteOptions {
  jobManager: JobManager;
}

const jobsRoutes: FastifyPluginCallback<JobsRouteOptions> = (
  fastify: FastifyInstance,
  opts: JobsRouteOptions,
  done
) => {
  const { jobManager } = opts;

  // -----------------------------------------------------------------------
  // POST /jobs — create a new job
  // -----------------------------------------------------------------------
  fastify.post('/jobs', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as Partial<CreateJobRequest> | undefined;

    if (!body || typeof body !== 'object') {
      return fail('jobs.create', 'INVALID_INPUT', 'Request body is required', reply, 400);
    }

    const { command, options } = body;

    if (!command || typeof command !== 'string') {
      return fail(
        'jobs.create',
        'INVALID_INPUT',
        '"command" is required and must be a string',
        reply,
        400
      );
    }

    if (!ALLOWED_COMMANDS.has(command)) {
      return fail(
        'jobs.create',
        'INVALID_COMMAND',
        `Unknown command "${command}". Allowed: ${[...ALLOWED_COMMANDS].join(', ')}`,
        reply,
        400
      );
    }

    if (
      options !== undefined &&
      (typeof options !== 'object' || options === null || Array.isArray(options))
    ) {
      return fail('jobs.create', 'INVALID_INPUT', '"options" must be a plain object', reply, 400);
    }

    // Validate option values against command metadata choices
    if (options && typeof options === 'object') {
      const validationError = validateOptionsAgainstChoices(
        command,
        options as Record<string, unknown>
      );
      if (validationError) {
        return fail('jobs.create', 'INVALID_OPTION_VALUE', validationError, reply, 400);
      }
    }

    try {
      const job = await jobManager.createJob(command, (options ?? {}) as Record<string, unknown>);
      return ok('jobs.create', job, reply, 201);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return fail('jobs.create', 'JOB_CREATE_FAILED', message, reply, 500);
    }
  });

  // -----------------------------------------------------------------------
  // GET /jobs — list jobs
  // -----------------------------------------------------------------------
  fastify.get(
    '/jobs',
    async (
      request: FastifyRequest<{
        Querystring: {
          status?: string;
          command?: string;
          limit?: string;
          offset?: string;
          sort?: string;
        };
      }>,
      reply: FastifyReply
    ) => {
      const { status, command, limit: limitStr, offset: offsetStr, sort } = request.query;

      // Validate status filter
      if (status && !Object.values(JobStatus).includes(status as JobStatus)) {
        return fail(
          'jobs.list',
          'INVALID_INPUT',
          `Invalid status filter "${status}". Allowed: ${Object.values(JobStatus).join(', ')}`,
          reply,
          400
        );
      }

      const limit = Math.max(1, Math.min(100, parseInt(limitStr || '20', 10) || 20));
      const offset = Math.max(0, parseInt(offsetStr || '0', 10) || 0);

      try {
        let jobs = await jobManager.listJobs({
          status: status as JobStatus | undefined,
          command,
        });

        // Sort
        const sortField = sort?.replace(/^-/, '') || 'createdAt';
        const sortDesc = !sort || sort.startsWith('-');

        if (sortField === 'createdAt') {
          jobs.sort((a, b) => {
            const diff = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
            return sortDesc ? -diff : diff;
          });
        }

        const total = jobs.length;
        jobs = jobs.slice(offset, offset + limit);

        return ok('jobs.list', { jobs, total, limit, offset }, reply);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return fail('jobs.list', 'LIST_FAILED', message, reply, 500);
      }
    }
  );

  // -----------------------------------------------------------------------
  // GET /jobs/:id — get single job
  // -----------------------------------------------------------------------
  fastify.get(
    '/jobs/:id',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const { id } = request.params;

      try {
        const job = await jobManager.getJob(id);
        if (!job) {
          return fail('jobs.get', 'NOT_FOUND', `Job "${id}" not found`, reply, 404);
        }
        return ok('jobs.get', job, reply);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return fail('jobs.get', 'GET_FAILED', message, reply, 500);
      }
    }
  );

  // -----------------------------------------------------------------------
  // POST /jobs/:id/cancel — cancel a running or queued job
  // -----------------------------------------------------------------------
  fastify.post(
    '/jobs/:id/cancel',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const { id } = request.params;

      try {
        const job = await jobManager.getJob(id);
        if (!job) {
          return fail('jobs.cancel', 'NOT_FOUND', `Job "${id}" not found`, reply, 404);
        }

        if (!CANCELLABLE_STATUSES.has(job.status)) {
          return fail(
            'jobs.cancel',
            'INVALID_STATE',
            `Cannot cancel job with status "${job.status}". Must be queued or running.`,
            reply,
            409
          );
        }

        const updated = await jobManager.cancelJob(id);
        return ok('jobs.cancel', updated, reply);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return fail('jobs.cancel', 'CANCEL_FAILED', message, reply, 500);
      }
    }
  );

  // -----------------------------------------------------------------------
  // POST /jobs/:id/resume — resume a failed or interrupted job
  // -----------------------------------------------------------------------
  fastify.post(
    '/jobs/:id/resume',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const { id } = request.params;

      try {
        const job = await jobManager.getJob(id);
        if (!job) {
          return fail('jobs.resume', 'NOT_FOUND', `Job "${id}" not found`, reply, 404);
        }

        if (!RESUMABLE_STATUSES.has(job.status)) {
          return fail(
            'jobs.resume',
            'INVALID_STATE',
            `Cannot resume job with status "${job.status}". Must be failed or interrupted.`,
            reply,
            409
          );
        }

        const resumed = await jobManager.resumeJob(id);
        return ok('jobs.resume', resumed, reply);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return fail('jobs.resume', 'RESUME_FAILED', message, reply, 500);
      }
    }
  );

  // -----------------------------------------------------------------------
  // DELETE /jobs/:id — delete a completed/failed/cancelled job record
  // -----------------------------------------------------------------------
  fastify.delete(
    '/jobs/:id',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const { id } = request.params;

      try {
        const job = await jobManager.getJob(id);
        if (!job) {
          return fail('jobs.delete', 'NOT_FOUND', `Job "${id}" not found`, reply, 404);
        }

        if (!DELETABLE_STATUSES.has(job.status)) {
          return fail(
            'jobs.delete',
            'INVALID_STATE',
            `Cannot delete job with status "${job.status}". Must be completed, failed, or cancelled.`,
            reply,
            409
          );
        }

        await jobManager.deleteJob(id);
        return ok('jobs.delete', { id, deleted: true }, reply);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return fail('jobs.delete', 'DELETE_FAILED', message, reply, 500);
      }
    }
  );

  done();
};

export default jobsRoutes;
