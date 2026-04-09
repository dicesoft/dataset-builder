import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import errorHandler from './errors';

/**
 * Tests for error handler middleware — JSON envelope errors, 404 handler, validation
 */

let app: FastifyInstance;

beforeEach(async () => {
  app = Fastify({ logger: false });
  await app.register(errorHandler);
});

afterEach(async () => {
  await app.close();
});

describe('error handler', () => {
  it('returns JSON envelope for thrown errors', async () => {
    app.get('/test-error', async () => {
      throw new Error('Something went wrong');
    });
    await app.ready();

    const res = await app.inject({ method: 'GET', url: '/test-error' });

    expect(res.statusCode).toBe(500);
    const body = res.json();
    expect(body.version).toBe(1);
    expect(body.success).toBe(false);
    expect(body.error).toBeDefined();
    expect(body.error.code).toBeDefined();
    expect(body.error.message).toBe('Internal server error');
  });

  it('returns 404 for unknown routes (setNotFoundHandler is in static.ts)', async () => {
    await app.ready();

    const res = await app.inject({ method: 'GET', url: '/nonexistent' });

    // Without static plugin, Fastify returns its default 404
    expect(res.statusCode).toBe(404);
  });

  it('returns original error message for client errors (4xx)', async () => {
    app.get('/test-client-error', async (_req, reply) => {
      reply.status(400);
      throw Object.assign(new Error('Bad input'), { statusCode: 400 });
    });
    await app.ready();

    const res = await app.inject({ method: 'GET', url: '/test-client-error' });

    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toBe('Bad input');
  });

  it('masks error message for server errors (5xx)', async () => {
    app.get('/test-server-error', async () => {
      throw Object.assign(new Error('Internal details'), { statusCode: 500 });
    });
    await app.ready();

    const res = await app.inject({ method: 'GET', url: '/test-server-error' });

    expect(res.statusCode).toBe(500);
    const body = res.json();
    expect(body.error.message).toBe('Internal server error');
    expect(body.error.details?.originalMessage).toBe('Internal details');
  });

  it('handles validation errors with VALIDATION_ERROR code', async () => {
    app.post(
      '/test-validate',
      {
        schema: {
          body: {
            type: 'object',
            required: ['name'],
            properties: { name: { type: 'string' } },
          },
        },
      },
      async () => ({ ok: true })
    );
    await app.ready();

    const res = await app.inject({
      method: 'POST',
      url: '/test-validate',
      payload: {},
    });

    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.message).toBe('Request validation failed');
    expect(body.error.details?.validationErrors).toBeDefined();
  });
});
