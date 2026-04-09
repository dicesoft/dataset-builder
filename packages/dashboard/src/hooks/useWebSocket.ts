import { useEffect, useRef, useState, useCallback } from 'react';
import { useJobStore } from '../stores/jobStore';

export type ConnectionStatus = 'connected' | 'disconnected' | 'reconnecting';

const MAX_BACKOFF_MS = 30_000;

function getWsUrl(): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/api/v1/ws`;
}

export function useWebSocket(): ConnectionStatus {
  const [status, setStatus] = useState<ConnectionStatus>('disconnected');
  const wsRef = useRef<WebSocket | null>(null);
  const backoffRef = useRef(1000);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  const { updateJobProgress, updateJobStatus, updateJobError, appendJobLog } =
    useJobStore.getState();

  const handleMessage = useCallback(
    (event: MessageEvent) => {
      try {
        const msg = JSON.parse(event.data);
        const { type, jobId, data } = msg;

        switch (type) {
          case 'job:progress':
            updateJobProgress(jobId, data);
            break;
          case 'job:status':
            updateJobStatus(jobId, data.status, data);
            break;
          case 'job:error':
            updateJobError(jobId, {
              code: data.code ?? 'UNKNOWN',
              message: data.message ?? 'Unknown error',
              details: data.details ?? null,
            });
            break;
          case 'job:log':
            appendJobLog(jobId, data.line);
            break;
        }
      } catch {
        // Ignore non-JSON or malformed messages
      }
    },
    [updateJobProgress, updateJobStatus, updateJobError, appendJobLog]
  );

  const connect = useCallback(() => {
    if (!mountedRef.current) return;

    const ws = new WebSocket(getWsUrl());
    wsRef.current = ws;

    ws.addEventListener('open', () => {
      if (!mountedRef.current) {
        ws.close();
        return;
      }
      setStatus('connected');
      backoffRef.current = 1000;
      ws.send(JSON.stringify({ type: 'subscribe_all' }));
    });

    ws.addEventListener('message', handleMessage);

    ws.addEventListener('close', () => {
      if (!mountedRef.current) return;
      setStatus('reconnecting');
      const baseDelay = backoffRef.current;
      // Add 0-50% random jitter to prevent thundering herd on server restart
      const delay = baseDelay * (1 + Math.random() * 0.5);
      backoffRef.current = Math.min(baseDelay * 2, MAX_BACKOFF_MS);
      reconnectTimerRef.current = setTimeout(connect, delay);
    });

    ws.addEventListener('error', () => {
      // The close event will fire after error, triggering reconnect
    });
  }, [handleMessage]);

  useEffect(() => {
    mountedRef.current = true;
    connect();

    return () => {
      mountedRef.current = false;
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
      }
      setStatus('disconnected');
    };
  }, [connect]);

  return status;
}
