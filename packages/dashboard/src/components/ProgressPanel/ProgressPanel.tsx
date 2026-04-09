import { useEffect, useRef, useState } from 'react';
import { Badge, Button, Code, Collapse, Group, Paper, Progress, Stack, Text } from '@mantine/core';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  useJobStore,
  getErrorMessage,
  type JobRecord,
  type JobErrorDetails,
} from '@/stores/jobStore';
import { useConfigStore } from '@/stores/configStore';
import { relativizePath } from '@/utils/paths';

export interface ProgressPanelProps {
  jobId: string;
  /** When true, the outline Badge counters row is not rendered. Useful when
   *  the parent renders its own counter display (e.g. Transform decision-log table). */
  hideCounters?: boolean;
}

function formatElapsed(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function useElapsedTimer(startedAt: string | null, completedAt: string | null): number {
  const [elapsed, setElapsed] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);

    if (!startedAt) {
      setElapsed(0);
      return;
    }

    const start = new Date(startedAt).getTime();

    if (completedAt) {
      setElapsed((new Date(completedAt).getTime() - start) / 1000);
      return;
    }

    // Running — update every second
    const tick = () => setElapsed((Date.now() - start) / 1000);
    tick();
    intervalRef.current = setInterval(tick, 1000);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [startedAt, completedAt]);

  return elapsed;
}

function ErrorDisplay({
  error,
  t,
}: {
  error: JobRecord['error'];
  t: ReturnType<typeof useTranslation>['t'];
}) {
  const [expanded, setExpanded] = useState(false);
  const details = typeof error === 'object' && error ? error.details : null;
  const stderr =
    typeof details === 'object' && details ? (details as JobErrorDetails).stderr : undefined;
  const exitCode =
    typeof details === 'object' && details ? (details as JobErrorDetails).exitCode : undefined;
  const signal =
    typeof details === 'object' && details ? (details as JobErrorDetails).signal : undefined;

  return (
    <Stack gap="xs">
      <Text size="sm" c="red">
        Error: {getErrorMessage(error)}
      </Text>
      {(exitCode != null || signal) && (
        <Group gap="xs">
          {exitCode != null && (
            <Badge size="sm" variant="light" color="gray">
              {t('jobs.exitCode', 'Exit code')}: {exitCode}
            </Badge>
          )}
          {signal && (
            <Badge size="sm" variant="light" color="orange">
              {t('jobs.signal', 'Signal')}: {signal}
            </Badge>
          )}
        </Group>
      )}
      {stderr && (
        <>
          <Button variant="subtle" size="compact-xs" onClick={() => setExpanded((v) => !v)}>
            {expanded
              ? t('jobs.hideErrorOutput', 'Hide error output')
              : t('jobs.showErrorOutput', 'Show error output')}
          </Button>
          <Collapse in={expanded}>
            <Code block style={{ maxHeight: 200, overflow: 'auto', fontSize: '0.75rem' }}>
              {stderr}
            </Code>
          </Collapse>
        </>
      )}
    </Stack>
  );
}

export function ProgressPanel({ jobId, hideCounters = false }: ProgressPanelProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const job = useJobStore((s) => s.jobs.get(jobId)) as JobRecord | undefined;
  const resolvedOutputDir = useConfigStore((s) => s.resolvedOutputDir);
  const elapsed = useElapsedTimer(job?.startedAt ?? null, job?.completedAt ?? null);

  if (!job) {
    return (
      <Paper p="md" withBorder>
        <Text c="dimmed">{t('jobs.noJobs')}</Text>
      </Paper>
    );
  }

  const { status, progress, error, outputPath } = job;
  const isQueued = status === 'queued' || status === 'pending';
  const isRunning = status === 'running';
  const isCompleted = status === 'completed';
  const isFailed = status === 'failed';

  const percent =
    progress && progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0;

  return (
    <Paper p="md" withBorder aria-live="polite" aria-atomic="true">
      <Stack gap="sm">
        {/* Status header */}
        <Group justify="space-between">
          <Group gap="xs">
            <Badge
              color={isCompleted ? 'green' : isFailed ? 'red' : isRunning ? 'blue' : 'gray'}
              variant="light"
            >
              {t(`jobs.status.${status}`, status)}
            </Badge>
            {progress?.phase && (
              <Text size="sm" fw={500}>
                {progress.phase}
              </Text>
            )}
          </Group>
          <Text size="sm" c="dimmed">
            {formatElapsed(elapsed)}
          </Text>
        </Group>

        {/* Queued state */}
        {isQueued && (
          <Text size="sm" c="dimmed">
            {t('jobs.progress.waiting')}
          </Text>
        )}

        {/* Progress bar */}
        {isRunning && progress && (
          <>
            <Progress
              value={percent}
              size="lg"
              radius="md"
              animated
              color="blue"
              aria-label={`Job progress: ${percent}%`}
              aria-valuenow={percent}
              aria-valuemin={0}
              aria-valuemax={100}
            />
            <Group justify="space-between">
              <Text size="xs" c="dimmed">
                {progress.current} / {progress.total} ({percent}%)
              </Text>
              {progress.throughput > 0 && (
                <Text size="xs" c="dimmed">
                  {progress.throughput.toFixed(1)} {t('jobs.progress.recordsPerSec')}
                </Text>
              )}
            </Group>
            {progress.message && (
              <Text size="xs" c="dimmed">
                {progress.message}
              </Text>
            )}
          </>
        )}

        {/* Counters */}
        {!hideCounters && progress?.counters && Object.keys(progress.counters).length > 0 && (
          <Group gap="xs">
            {Object.entries(progress.counters).map(([key, val]) => (
              <Badge key={key} variant="outline" size="sm">
                {key}: {val}
              </Badge>
            ))}
          </Group>
        )}

        {/* Completed state */}
        {isCompleted && (
          <Stack gap="xs">
            <Text size="sm" c="green">
              {t('jobs.status.completed')}
            </Text>
            {outputPath && (
              <>
                <Text size="sm">
                  {t('jobs.output')}:{' '}
                  <Text
                    component="a"
                    href={`/data/${encodeURIComponent(outputPath)}`}
                    c="blue"
                    td="underline"
                    size="sm"
                    onClick={(e: React.MouseEvent) => {
                      e.preventDefault();
                      navigate(`/data/${encodeURIComponent(outputPath)}`);
                    }}
                    style={{ cursor: 'pointer' }}
                  >
                    {relativizePath(outputPath, resolvedOutputDir)}
                  </Text>
                </Text>
                <Button
                  variant="light"
                  size="compact-sm"
                  onClick={() => navigate(`/data/${encodeURIComponent(outputPath)}`)}
                >
                  {t('jobs.viewDataset')}
                </Button>
              </>
            )}
          </Stack>
        )}

        {/* Failed state */}
        {isFailed && error && <ErrorDisplay error={error} t={t} />}
      </Stack>
    </Paper>
  );
}
