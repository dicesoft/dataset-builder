/**
 * T010: Global error handler middleware
 * Returns JSON envelope format for all errors
 */

import { FastifyInstance, FastifyError, FastifyRequest, FastifyReply } from 'fastify';
import fp from 'fastify-plugin';

interface ErrorEnvelope {
  version: 1;
  success: false;
  error: {
    code: string;
    message: string;
    details: Record<string, unknown> | null;
  };
}

function buildErrorEnvelope(
  code: string,
  message: string,
  details: Record<string, unknown> | null = null
): ErrorEnvelope {
  return {
    version: 1,
    success: false,
    error: { code, message, details },
  };
}

async function errorHandlerPlugin(fastify: FastifyInstance): Promise<void> {
  fastify.setErrorHandler((error: FastifyError, _request: FastifyRequest, reply: FastifyReply) => {
    const statusCode = error.statusCode || 500;

    // Validation errors (from Fastify schema validation)
    if (error.validation) {
      const envelope = buildErrorEnvelope('VALIDATION_ERROR', 'Request validation failed', {
        validationErrors: error.validation,
      });
      return reply.status(400).send(envelope);
    }

    // Not found errors
    if (statusCode === 404) {
      const envelope = buildErrorEnvelope('NOT_FOUND', error.message || 'Resource not found');
      return reply.status(404).send(envelope);
    }

    // All other errors
    const envelope = buildErrorEnvelope(
      error.code || 'INTERNAL_ERROR',
      statusCode >= 500 ? 'Internal server error' : error.message,
      statusCode >= 500 ? { originalMessage: error.message } : null
    );

    // Log server errors
    if (statusCode >= 500) {
      fastify.log.error(error);
    }

    return reply.status(statusCode).send(envelope);
  });

  // Note: setNotFoundHandler is registered by the static plugin (static.ts)
  // which handles both API 404s (JSON envelope) and SPA fallback (index.html)
}

export default fp(errorHandlerPlugin, {
  name: 'error-handler',
  fastify: '5.x',
});
