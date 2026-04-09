/**
 * T017: WebSocket progress multiplexer
 * Accepts WS connections, handles subscribe/unsubscribe, forwards job events
 */

import { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { WebSocket } from '@fastify/websocket';
import { getJobManager } from '../jobs/manager';
import { JobProgress, JobError, JobRecord } from '../jobs/types';

interface ClientSubscription {
  socket: WebSocket;
  subscribedJobs: Set<string>;
  subscribeAll: boolean;
}

// Track all connected clients and their subscriptions
const clients = new Map<WebSocket, ClientSubscription>();

/**
 * Send a JSON message to a WebSocket client
 */
function sendToClient(socket: WebSocket, message: unknown): void {
  if (socket.readyState === WebSocket.OPEN) {
    try {
      socket.send(JSON.stringify(message));
    } catch {
      // Client disconnected or error sending
    }
  }
}

/**
 * Broadcast an event to all clients subscribed to a job
 */
function broadcastToSubscribers(jobId: string, type: string, data: unknown): void {
  for (const client of clients.values()) {
    if (client.subscribeAll || client.subscribedJobs.has(jobId)) {
      sendToClient(client.socket, { type, jobId, data });
    }
  }
}

async function wsProgressPlugin(fastify: FastifyInstance): Promise<void> {
  // Wire up job manager events to broadcast to WS clients
  const manager = getJobManager();

  manager.on('job:progress', (jobId: string, progress: JobProgress) => {
    broadcastToSubscribers(jobId, 'job:progress', progress);
  });

  manager.on('job:status', (jobId: string, record: JobRecord) => {
    const data: Record<string, unknown> = {
      status: record.status,
      completedAt: record.completedAt,
      duration: record.duration,
      outputPath: record.outputPath,
    };

    // Include result data for completed jobs so the frontend can render summaries
    if (record.status === 'completed') {
      data.result = record.result;
    }

    broadcastToSubscribers(jobId, 'job:status', data);
  });

  manager.on('job:error', (jobId: string, error: JobError) => {
    broadcastToSubscribers(jobId, 'job:error', error);
  });

  manager.on('job:log', (jobId: string, line: string) => {
    broadcastToSubscribers(jobId, 'job:log', { line });
  });

  // Register WebSocket route
  fastify.get('/api/v1/ws', { websocket: true }, (socket: WebSocket, _request) => {
    // Register client
    const subscription: ClientSubscription = {
      socket,
      subscribedJobs: new Set(),
      subscribeAll: false,
    };
    clients.set(socket, subscription);

    fastify.log.info(`WebSocket client connected (${clients.size} total)`);

    // Handle incoming messages
    socket.on('message', (rawData: Buffer | string) => {
      try {
        const message = JSON.parse(typeof rawData === 'string' ? rawData : rawData.toString());

        switch (message.type) {
          case 'subscribe':
            if (message.jobId && typeof message.jobId === 'string') {
              subscription.subscribedJobs.add(message.jobId);
              sendToClient(socket, {
                type: 'subscribed',
                jobId: message.jobId,
              });
            }
            break;

          case 'unsubscribe':
            if (message.jobId && typeof message.jobId === 'string') {
              subscription.subscribedJobs.delete(message.jobId);
              sendToClient(socket, {
                type: 'unsubscribed',
                jobId: message.jobId,
              });
            }
            break;

          case 'subscribe_all':
            subscription.subscribeAll = true;
            sendToClient(socket, { type: 'subscribed_all' });
            break;

          default:
            sendToClient(socket, {
              type: 'error',
              message: `Unknown message type: ${message.type}`,
            });
        }
      } catch {
        sendToClient(socket, {
          type: 'error',
          message: 'Invalid JSON message',
        });
      }
    });

    // Handle disconnect
    socket.on('close', () => {
      clients.delete(socket);
      fastify.log.info(`WebSocket client disconnected (${clients.size} remaining)`);
    });

    socket.on('error', (err: Error) => {
      fastify.log.error(`WebSocket error: ${err.message}`);
      clients.delete(socket);
    });
  });
}

/**
 * Get the count of connected WebSocket clients
 */
export function getConnectedClientCount(): number {
  return clients.size;
}

export default fp(wsProgressPlugin, {
  name: 'ws-progress',
  fastify: '5.x',
});
