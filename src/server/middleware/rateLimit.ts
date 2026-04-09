/**
 * Simple in-memory rate limiter middleware for Fastify.
 * Limits requests per IP address using a sliding window counter.
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import fp from 'fastify-plugin';

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

interface RateLimitConfig {
  /** Max requests per window */
  max: number;
  /** Window duration in milliseconds */
  windowMs: number;
}

const defaultConfig: RateLimitConfig = { max: 100, windowMs: 60_000 };

/** Route-specific overrides keyed by route prefix patterns */
const routeConfigs: { pattern: RegExp; config: RateLimitConfig }[] = [
  // Job creation: 10 per minute
  { pattern: /^\/api\/v1\/jobs$/, config: { max: 10, windowMs: 60_000 } },
  // File uploads: 5 per minute
  { pattern: /^\/api\/v1\/upload/, config: { max: 5, windowMs: 60_000 } },
];

function getConfig(url: string): RateLimitConfig {
  for (const { pattern, config } of routeConfigs) {
    if (pattern.test(url)) return config;
  }
  return defaultConfig;
}

// Stores keyed by "ip:configKey" for separate buckets
const stores = new Map<string, RateLimitEntry>();

// Cleanup stale entries every 5 minutes
const cleanupInterval = setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of stores) {
    if (now > entry.resetAt) stores.delete(key);
  }
}, 5 * 60_000);
cleanupInterval.unref();

function getStoreKey(ip: string, config: RateLimitConfig): string {
  return `${ip}:${config.max}:${config.windowMs}`;
}

async function rateLimitPlugin(fastify: FastifyInstance) {
  fastify.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    const url = request.url;

    // Only rate-limit API routes
    if (!url.startsWith('/api/')) return;

    const config = getConfig(url);
    const ip = request.ip;
    const key = getStoreKey(ip, config);
    const now = Date.now();

    let entry = stores.get(key);
    if (!entry || now > entry.resetAt) {
      entry = { count: 0, resetAt: now + config.windowMs };
      stores.set(key, entry);
    }

    entry.count++;

    const remaining = Math.max(0, config.max - entry.count);
    const resetSeconds = Math.ceil((entry.resetAt - now) / 1000);

    reply.header('X-RateLimit-Limit', config.max);
    reply.header('X-RateLimit-Remaining', remaining);
    reply.header('X-RateLimit-Reset', resetSeconds);

    if (entry.count > config.max) {
      reply.code(429);
      reply.send({
        version: 1,
        success: false,
        error: {
          code: 'RATE_LIMIT_EXCEEDED',
          message: `Too many requests. Limit: ${config.max} per ${config.windowMs / 1000}s. Try again in ${resetSeconds}s.`,
          details: null,
        },
      });
    }
  });
}

export default fp(rateLimitPlugin, { name: 'rate-limit' });
