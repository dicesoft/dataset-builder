/**
 * T011: Static file serving plugin for SPA
 * Serves packages/dashboard/dist/ and falls back to index.html for client-side routing
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import fastifyStatic from '@fastify/static';
import fp from 'fastify-plugin';
import path from 'path';
import fs from 'fs';

async function staticPlugin(fastify: FastifyInstance): Promise<void> {
  const distDir = path.resolve(process.cwd(), 'packages', 'dashboard', 'dist');

  // Only register static serving if the dist directory exists
  if (!fs.existsSync(distDir)) {
    fastify.log.warn(
      `Dashboard dist directory not found at ${distDir}. Static file serving disabled.`
    );
    return;
  }

  // Register @fastify/static for serving built dashboard files
  await fastify.register(fastifyStatic, {
    root: distDir,
    prefix: '/',
    wildcard: false,
    // Don't serve index.html for directory requests - we handle SPA fallback below
    index: false,
  });

  // SPA fallback: serve index.html for any non-API, non-file request
  fastify.setNotFoundHandler((_request: FastifyRequest, reply: FastifyReply) => {
    const url = _request.url;

    // Don't intercept API routes - let them 404 naturally
    if (url.startsWith('/api/')) {
      return reply.status(404).send({
        version: 1,
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'Route not found',
          details: null,
        },
      });
    }

    // Check if the request looks like a file (has an extension)
    const ext = path.extname(url);
    if (ext && ext !== '.html') {
      // Actual file request that wasn't found
      return reply.status(404).send({
        version: 1,
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'File not found',
          details: null,
        },
      });
    }

    // SPA fallback: serve index.html
    return reply.sendFile('index.html');
  });
}

export default fp(staticPlugin, {
  name: 'static-files',
  fastify: '5.x',
  dependencies: ['error-handler'],
});
