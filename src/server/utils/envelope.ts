/**
 * Shared API response envelope helpers.
 * All API routes return responses wrapped in this standard format.
 */

import { FastifyReply } from 'fastify';

export interface ApiEnvelope<T = unknown> {
  version: 1;
  success: boolean;
  command: string;
  data?: T;
  error?: { code: string; message: string; details?: unknown };
}

export function ok<T>(command: string, data: T, reply: FastifyReply, statusCode = 200): void {
  const envelope: ApiEnvelope<T> = { version: 1, success: true, command, data };
  reply.status(statusCode).send(envelope);
}

export function fail(
  command: string,
  code: string,
  message: string,
  reply: FastifyReply,
  statusCode = 400,
  details?: unknown
): void {
  const envelope: ApiEnvelope = {
    version: 1,
    success: false,
    command,
    error: { code, message, ...(details !== undefined ? { details } : {}) },
  };
  reply.status(statusCode).send(envelope);
}
