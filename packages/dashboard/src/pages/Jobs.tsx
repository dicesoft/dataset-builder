import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Card,
  Code,
  Collapse,
  Container,
  Divider,
  Drawer,
  Group,
  Menu,
  Select,
  Skeleton,
  Stack,
  Text,
  Title,
  Tooltip,
} from '@mantine/core';
import { useNavigate } from 'react-router-dom';
import { MantineReactTable, useMantineReactTable, type MRT_ColumnDef } from 'mantine-react-table';
import { useTranslation } from 'react-i18next';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import {
  useJobStore,
  getErrorMessage,
  type JobRecord,
  type JobError,
  type JobErrorDetails,
} from '@/stores/jobStore';
import { useJob } from '@/hooks/useJob';
import { ProgressPanel } from '@/components/ProgressPanel/ProgressPanel';
import { useConfigStore } from '@/stores/configStore';
import { relativizePath } from '@/utils/paths';

dayjs.extend(relativeTime);

const LOGS_TRUNCATE_LIMIT = 50;

const STATUS_COLORS: Record<string, string> = {
  queued: 'gray',
  pending: 'gray',
  running: 'blue',
  completed: 'green',
  failed: 'red',
  cancelled: 'orange',
  interrupted: 'yellow',
};

function useStatusOptions() {
  const { t } = useTranslation();
  return useMemo(
    () => [
      { value: 'all', label: t('jobs.statusAll') },
      { value: 'queued', label: t('jobs.status.queued') },
      { value: 'running', label: t('jobs.status.running') },
      { value: 'completed', label: t('jobs.status.completed') },
      { value: 'failed', label: t('jobs.status.failed') },
      { value: 'cancelled', label: t('jobs.status.cancelled') },
      { value: 'interrupted', label: t('jobs.status.interrupted') },
    ],
    [t]
  );
}

function formatDuration(ms: number | null): string {
  if (ms == null) return '-';
  const seconds = Math.floor(ms / 1000);
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString();
}

export default function Jobs() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const fetchJobs = useJobStore((s) => s.fetchJobs);
  const jobsMap = useJobStore((s) => s.jobs);
  const removeJob = useJobStore((s) => s.removeJob);
  const { cancelJob } = useJob();
  const resolvedOutputDir = useConfigStore((s) => s.resolvedOutputDir);

  const statusOptions = useStatusOptions();
  const [statusFilter, setStatusFilter] = useState('all');
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [resumeError, setResumeError] = useState<string | null>(null);
  const [showAllLogs, setShowAllLogs] = useState(false);
  const [logsExpanded, setLogsExpanded] = useState(false);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const [errorDetailsExpanded, setErrorDetailsExpanded] = useState(false);

  // Initial fetch
  useEffect(() => {
    fetchJobs().finally(() => setLoading(false));
  }, [fetchJobs]);

  // Filter jobs
  const jobs = useMemo(() => {
    const all = Array.from(jobsMap.values());
    const filtered = statusFilter === 'all' ? all : all.filter((j) => j.status === statusFilter);
    return filtered.sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }, [jobsMap, statusFilter]);

  const selectedJob = selectedJobId ? jobsMap.get(selectedJobId) : undefined;

  // Auto-scroll logs to bottom when new lines arrive
  useEffect(() => {
    if (logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [selectedJob?.logs?.length]);

  const handleCancel = useCallback(
    async (jobId: string) => {
      try {
        await cancelJob(jobId);
        await fetchJobs();
      } catch {
        // handled by useJob
      }
    },
    [cancelJob, fetchJobs]
  );

  const handleResume = useCallback(
    async (jobId: string) => {
      setResumeError(null);
      try {
        const { apiPost } = await import('@/utils/api');
        await apiPost(`/api/v1/jobs/${jobId}/resume`);
        await fetchJobs();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setResumeError(message);
      }
    },
    [fetchJobs]
  );

  const handleDelete = useCallback(
    async (jobId: string) => {
      try {
        await removeJob(jobId);
      } catch {
        // handled by store
      }
    },
    [removeJob]
  );

  const isTerminal = (status: string) => ['completed', 'failed', 'cancelled'].includes(status);
  const isActive = (status: string) => ['running', 'queued', 'pending'].includes(status);
  const isResumable = (status: string) => ['failed', 'interrupted'].includes(status);

  const columns = useMemo<MRT_ColumnDef<JobRecord>[]>(
    () => [
      {
        accessorKey: 'command',
        header: t('jobs.command', 'Command'),
        size: 140,
      },
      {
        accessorKey: 'status',
        header: t('common.status'),
        size: 160,
        Cell: ({ row }) => {
          const job = row.original;
          const status = job.status;
          const errMsg = status === 'failed' && job.error ? getErrorMessage(job.error) : null;
          const truncatedErr = errMsg && errMsg.length > 60 ? errMsg.slice(0, 60) + '...' : errMsg;
          return (
            <Stack gap={2}>
              <Badge color={STATUS_COLORS[status] ?? 'gray'} variant="light">
                {t(`jobs.status.${status}`, status)}
              </Badge>
              {truncatedErr && (
                <Tooltip label={errMsg} multiline maw={400}>
                  <Text size="xs" c="red" lineClamp={1}>
                    {truncatedErr}
                  </Text>
                </Tooltip>
              )}
            </Stack>
          );
        },
      },
      {
        accessorKey: 'createdAt',
        header: t('jobs.created', 'Created'),
        size: 150,
        Cell: ({ cell }) => {
          const iso = cell.getValue<string>();
          return (
            <Tooltip label={formatDate(iso)}>
              <Text size="sm">{dayjs(iso).fromNow()}</Text>
            </Tooltip>
          );
        },
        sortingFn: 'datetime',
      },
      {
        accessorKey: 'duration',
        header: t('jobs.duration', 'Duration'),
        size: 120,
        Cell: ({ cell }) => <Text size="sm">{formatDuration(cell.getValue<number | null>())}</Text>,
      },
      {
        id: 'actions',
        header: '',
        size: 50,
        Cell: ({ row }) => {
          const job = row.original;
          const hasActions =
            isActive(job.status) || isResumable(job.status) || isTerminal(job.status);
          if (!hasActions) return null;
          return (
            <Menu shadow="md" width={160} position="bottom-end" withinPortal>
              <Menu.Target>
                <ActionIcon
                  variant="subtle"
                  color="gray"
                  size="sm"
                  onClick={(e) => e.stopPropagation()}
                  aria-label={t('common.actions')}
                >
                  &#x22EE;
                </ActionIcon>
              </Menu.Target>
              <Menu.Dropdown>
                {isActive(job.status) && (
                  <Menu.Item
                    color="orange"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleCancel(job.id);
                    }}
                  >
                    {t('jobs.cancel')}
                  </Menu.Item>
                )}
                {isResumable(job.status) && (
                  <Menu.Item
                    color="blue"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleResume(job.id);
                    }}
                  >
                    {t('jobs.resume')}
                  </Menu.Item>
                )}
                {isTerminal(job.status) && (
                  <Menu.Item
                    color="red"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDelete(job.id);
                    }}
                  >
                    {t('common.delete')}
                  </Menu.Item>
                )}
              </Menu.Dropdown>
            </Menu>
          );
        },
      },
    ],
    [t, handleCancel, handleResume, handleDelete]
  );

  const table = useMantineReactTable({
    columns,
    data: jobs,
    enableColumnActions: false,
    enableColumnFilters: false,
    enablePagination: true,
    enableSorting: true,
    enableGlobalFilter: false,
    enableTopToolbar: false,
    enableBottomToolbar: false,
    initialState: {
      sorting: [{ id: 'createdAt', desc: true }],
      density: 'xs',
      pagination: { pageIndex: 0, pageSize: 50 },
    },
    mantineTableBodyRowProps: ({ row }) => {
      const isSelected = row.original.id === selectedJobId;
      return {
        tabIndex: 0,
        onClick: () => setSelectedJobId(row.original.id),
        onKeyDown: (e: React.KeyboardEvent<HTMLTableRowElement>) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setSelectedJobId(row.original.id);
          }
        },
        style: {
          cursor: 'pointer',
          backgroundColor: isSelected ? 'var(--mantine-color-blue-light)' : undefined,
          transition: 'background-color 150ms ease',
        },
        onMouseEnter: (e: React.MouseEvent<HTMLTableRowElement>) => {
          if (!isSelected) {
            e.currentTarget.style.backgroundColor = 'var(--mantine-color-gray-light-hover)';
          }
        },
        onMouseLeave: (e: React.MouseEvent<HTMLTableRowElement>) => {
          if (!isSelected) {
            e.currentTarget.style.backgroundColor = '';
          }
        },
      };
    },
  });

  return (
    <Container size="xl" py="md">
      <Stack gap="lg">
        <Group justify="space-between" align="flex-end">
          <div>
            <Title order={2} mb={4}>
              {t('jobs.title')}
            </Title>
            <Text c="dimmed" size="sm">
              {t('jobs.description', 'View and manage all jobs')}
            </Text>
          </div>
          <Select
            label={t('jobs.statusFilter', 'Status')}
            data={statusOptions}
            value={statusFilter}
            onChange={(v) => setStatusFilter(v ?? 'all')}
            w={160}
          />
        </Group>

        {loading ? (
          <Stack gap="xs">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} height={40} />
            ))}
          </Stack>
        ) : jobs.length === 0 ? (
          <Card withBorder p="xl" ta="center">
            <Stack gap="md" align="center">
              <Text size="2rem">📋</Text>
              <Text size="lg" fw={500}>
                {t('jobs.noJobs')}
              </Text>
              <Text size="sm" c="dimmed" maw={400}>
                {t('jobs.emptyHint')}
              </Text>
              <Group>
                <Button onClick={() => navigate('/scrape')} variant="light">
                  {t('dashboard.startScrape')}
                </Button>
                <Button onClick={() => navigate('/generate')} variant="subtle">
                  {t('dashboard.startGenerate')}
                </Button>
              </Group>
            </Stack>
          </Card>
        ) : (
          <MantineReactTable table={table} />
        )}

        {/* Job detail drawer */}
        <Drawer
          opened={!!selectedJobId}
          onClose={() => {
            setSelectedJobId(null);
            setResumeError(null);
            setShowAllLogs(false);
            setLogsExpanded(false);
            setErrorDetailsExpanded(false);
          }}
          title={t('jobs.jobDetail', 'Job Detail')}
          position="right"
          size="lg"
        >
          {!selectedJob ? (
            selectedJobId ? (
              <Alert color="yellow" title={t('jobs.jobNotFound', 'Job not found')}>
                <Text size="sm">
                  {t(
                    'jobs.jobNotFoundHint',
                    'This job may have been deleted or is no longer available.'
                  )}
                </Text>
              </Alert>
            ) : null
          ) : (
            <Stack gap="md">
              {/* Resume error alert */}
              {resumeError && (
                <Alert
                  color="red"
                  title={t('jobs.resumeFailed', 'Resume failed')}
                  withCloseButton
                  onClose={() => setResumeError(null)}
                >
                  <Text size="sm">{resumeError}</Text>
                </Alert>
              )}

              {/* Summary section */}
              <div>
                <Text fw={600} size="sm" c="dimmed" mb={4}>
                  {t('jobs.summary', 'Summary')}
                </Text>
                <Stack gap="xs">
                  <Group gap="xs">
                    <Text fw={600}>{t('jobs.jobId', 'Job ID')}:</Text>
                    <Text ff="monospace" size="sm">
                      {selectedJob.id}
                    </Text>
                  </Group>
                  <Group gap="xs">
                    <Text fw={600}>{t('jobs.command', 'Command')}:</Text>
                    <Text size="sm">{selectedJob.command}</Text>
                  </Group>
                  <Group gap="xs">
                    <Text fw={600}>{t('common.status')}:</Text>
                    <Badge color={STATUS_COLORS[selectedJob.status] ?? 'gray'} variant="light">
                      {t(`jobs.status.${selectedJob.status}`, selectedJob.status)}
                    </Badge>
                  </Group>
                  <Group gap="xs">
                    <Text fw={600}>{t('jobs.created', 'Created')}:</Text>
                    <Text size="sm">{formatDate(selectedJob.createdAt)}</Text>
                  </Group>
                  {selectedJob.startedAt && (
                    <Group gap="xs">
                      <Text fw={600}>{t('jobs.startedAt', 'Started')}:</Text>
                      <Text size="sm">{formatDate(selectedJob.startedAt)}</Text>
                    </Group>
                  )}
                  {selectedJob.completedAt && (
                    <Group gap="xs">
                      <Text fw={600}>{t('jobs.completedAt', 'Completed')}:</Text>
                      <Text size="sm">{formatDate(selectedJob.completedAt)}</Text>
                    </Group>
                  )}
                  {selectedJob.duration != null && (
                    <Group gap="xs">
                      <Text fw={600}>{t('jobs.duration', 'Duration')}:</Text>
                      <Text size="sm">{formatDuration(selectedJob.duration)}</Text>
                    </Group>
                  )}
                </Stack>
              </div>

              {/* Results section */}
              {selectedJob.status === 'completed' &&
                (() => {
                  // Normalize result: when the executor can't parse the CLI's
                  // stdout envelope, it stores the raw stdout string as the
                  // result. Try to recover a structured shape so the drawer
                  // shows a useful summary instead of character indices.
                  let structured: Record<string, unknown> | null = null;
                  const rawResult = selectedJob.result as unknown;
                  if (rawResult && typeof rawResult === 'object' && !Array.isArray(rawResult)) {
                    structured = rawResult as Record<string, unknown>;
                  } else if (typeof rawResult === 'string' && rawResult.trim().length > 0) {
                    // Scan from the end for a JSON envelope (mirrors executor.ts)
                    const lines = rawResult.trim().split(/\r?\n/);
                    for (let i = lines.length - 1; i >= 0; i--) {
                      const line = lines[i].trim();
                      if (!line.startsWith('{')) continue;
                      try {
                        const parsed = JSON.parse(line);
                        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                          structured =
                            parsed.success && parsed.data && typeof parsed.data === 'object'
                              ? (parsed.data as Record<string, unknown>)
                              : (parsed as Record<string, unknown>);
                          break;
                        }
                      } catch {
                        /* keep scanning */
                      }
                    }
                  }

                  const rawFallback =
                    typeof rawResult === 'string' && !structured ? rawResult : null;
                  const hasStructuredFields =
                    structured !== null && Object.keys(structured).length > 0;

                  return (
                    <>
                      <Divider />
                      <div>
                        <Text fw={600} size="sm" c="dimmed" mb={4}>
                          {t('jobs.results')}
                        </Text>
                        {hasStructuredFields ? (
                          <Stack gap="xs">
                            {structured!.records != null && (
                              <Group gap="xs">
                                <Text fw={500} size="sm">
                                  {t('jobs.recordCount')}:
                                </Text>
                                <Badge variant="light">{String(structured!.records)}</Badge>
                              </Group>
                            )}
                            {structured!.outputCount != null && (
                              <Group gap="xs">
                                <Text fw={500} size="sm">
                                  {t('jobs.recordCount')}:
                                </Text>
                                <Badge variant="light">{String(structured!.outputCount)}</Badge>
                              </Group>
                            )}
                            {structured!.outputFile != null && (
                              <Group gap="xs">
                                <Text fw={500} size="sm">
                                  {t('jobs.outputFile')}:
                                </Text>
                                <Text size="sm" ff="monospace">
                                  {relativizePath(
                                    String(structured!.outputFile),
                                    resolvedOutputDir
                                  )}
                                </Text>
                              </Group>
                            )}
                            {structured!.urlsScraped != null && (
                              <Group gap="xs">
                                <Text fw={500} size="sm">
                                  {t('jobs.urlsScraped')}:
                                </Text>
                                <Badge variant="light">{String(structured!.urlsScraped)}</Badge>
                              </Group>
                            )}
                            {/* Fallback: show any remaining fields as JSON */}
                            {(() => {
                              const knownKeys = new Set([
                                'records',
                                'outputCount',
                                'outputFile',
                                'outputDir',
                                'urlsScraped',
                              ]);
                              const extra = Object.entries(structured!).filter(
                                ([k]) => !knownKeys.has(k)
                              );
                              if (extra.length === 0) return null;
                              return (
                                <Code block style={{ maxHeight: 200, overflow: 'auto' }}>
                                  {JSON.stringify(Object.fromEntries(extra), null, 2)}
                                </Code>
                              );
                            })()}
                            {(selectedJob.outputPath ||
                              typeof structured!.outputFile === 'string') && (
                              <Button
                                variant="light"
                                size="sm"
                                mt="xs"
                                onClick={() => {
                                  const target =
                                    selectedJob.outputPath || (structured!.outputFile as string);
                                  navigate(`/data/${encodeURIComponent(target)}`);
                                }}
                              >
                                {t('jobs.viewDataset')}
                              </Button>
                            )}
                          </Stack>
                        ) : rawFallback ? (
                          <Stack gap="xs">
                            <Text size="xs" c="dimmed">
                              {t('jobs.rawOutputNote', 'CLI output could not be parsed as JSON')}
                            </Text>
                            <Code block style={{ maxHeight: 300, overflow: 'auto' }}>
                              {rawFallback}
                            </Code>
                          </Stack>
                        ) : (
                          <Text size="sm" c="dimmed">
                            {t('jobs.noResults')}
                          </Text>
                        )}
                      </div>
                    </>
                  );
                })()}

              {/* Error section */}
              {selectedJob.error && (
                <>
                  <Divider />
                  <Alert
                    color="red"
                    aria-live="assertive"
                    title={
                      <Group gap="xs">
                        <Text fw={600}>{t('common.error')}</Text>
                        {typeof selectedJob.error === 'object' && selectedJob.error.code && (
                          <Badge size="sm" color="red" variant="light">
                            {selectedJob.error.code}
                          </Badge>
                        )}
                      </Group>
                    }
                  >
                    <Text size="sm">{getErrorMessage(selectedJob.error)}</Text>
                    {typeof selectedJob.error === 'object' && selectedJob.error.details && (
                      <>
                        {typeof selectedJob.error.details === 'object' &&
                          (selectedJob.error.details as JobErrorDetails).exitCode != null && (
                            <Group gap="xs" mt="xs">
                              <Badge size="sm" variant="light" color="gray">
                                {t('jobs.exitCode', 'Exit code')}:{' '}
                                {(selectedJob.error.details as JobErrorDetails).exitCode}
                              </Badge>
                              {(selectedJob.error.details as JobErrorDetails).signal && (
                                <Badge size="sm" variant="light" color="orange">
                                  {t('jobs.signal', 'Signal')}:{' '}
                                  {(selectedJob.error.details as JobErrorDetails).signal}
                                </Badge>
                              )}
                            </Group>
                          )}
                        {typeof selectedJob.error.details === 'object' &&
                        (selectedJob.error.details as JobErrorDetails).stderr ? (
                          <>
                            <Button
                              variant="subtle"
                              size="compact-xs"
                              mt="xs"
                              onClick={() => setErrorDetailsExpanded((v) => !v)}
                            >
                              {errorDetailsExpanded
                                ? t('jobs.hideErrorOutput', 'Hide error output')
                                : t('jobs.showErrorOutput', 'Show error output')}
                            </Button>
                            <Collapse in={errorDetailsExpanded}>
                              <Text size="xs" fw={600} c="dimmed" mt="xs" mb={4}>
                                {t('jobs.stderrOutput', 'stderr output')}
                              </Text>
                              <Code block style={{ maxHeight: 200, overflow: 'auto' }}>
                                {(selectedJob.error.details as JobErrorDetails).stderr}
                              </Code>
                            </Collapse>
                          </>
                        ) : (
                          <>
                            <Button
                              variant="subtle"
                              size="compact-xs"
                              mt="xs"
                              onClick={() => setErrorDetailsExpanded((v) => !v)}
                            >
                              {errorDetailsExpanded
                                ? t('common.hideDetails', 'Hide details')
                                : t('common.showDetails', 'Show details')}
                            </Button>
                            <Collapse in={errorDetailsExpanded}>
                              <Code block mt="xs" style={{ maxHeight: 200, overflow: 'auto' }}>
                                {typeof selectedJob.error.details === 'string'
                                  ? selectedJob.error.details
                                  : JSON.stringify(selectedJob.error.details, null, 2)}
                              </Code>
                            </Collapse>
                          </>
                        )}
                      </>
                    )}
                  </Alert>
                </>
              )}

              {/* Options section */}
              {selectedJob.options &&
                Object.keys(selectedJob.options).length > 0 &&
                (() => {
                  const entries = Object.entries(selectedJob.options!).filter(
                    ([, v]) => v != null && v !== '' && v !== false
                  );
                  if (entries.length === 0) return null;
                  return (
                    <>
                      <Divider />
                      <div>
                        <Text fw={600} size="sm" c="dimmed" mb={4}>
                          {t('jobs.options', 'Options')}
                        </Text>
                        <Stack gap={4}>
                          {entries.map(([key, value]) => (
                            <Group key={key} gap="xs">
                              <Text fw={500} size="sm" ff="monospace">
                                {key}:
                              </Text>
                              <Text size="sm">
                                {typeof value === 'object' ? JSON.stringify(value) : String(value)}
                              </Text>
                            </Group>
                          ))}
                        </Stack>
                      </div>
                    </>
                  );
                })()}

              {/* Logs section */}
              {(() => {
                const isRunning = selectedJob.status === 'running';
                const hasLogs = selectedJob.logs && selectedJob.logs.length > 0;
                if (!hasLogs && !isRunning) return null;
                return (
                  <>
                    <Divider />
                    <div>
                      <Group justify="space-between" mb={4}>
                        <Group gap="xs">
                          <Text fw={600} size="sm" c="dimmed">
                            {t('jobs.logs', 'Logs')}
                            {hasLogs &&
                              ` (${selectedJob.logs!.length} ${t('jobs.lines', 'lines')})`}
                          </Text>
                          {isRunning && (
                            <Badge size="xs" variant="dot" color="blue">
                              {t('jobs.live', 'Live')}
                            </Badge>
                          )}
                        </Group>
                        <Button
                          variant="subtle"
                          size="compact-xs"
                          onClick={() => setLogsExpanded((v) => !v)}
                        >
                          {logsExpanded || isRunning
                            ? t('common.collapse', 'Collapse')
                            : t('common.expand', 'Expand')}
                        </Button>
                      </Group>
                      <Collapse in={logsExpanded || isRunning}>
                        <Code
                          block
                          style={{ maxHeight: 300, overflow: 'auto', fontSize: '0.75rem' }}
                        >
                          {hasLogs
                            ? (() => {
                                const lines = selectedJob.logs!;
                                if (lines.length <= LOGS_TRUNCATE_LIMIT || showAllLogs) {
                                  return lines.join('\n');
                                }
                                return lines.slice(-LOGS_TRUNCATE_LIMIT).join('\n');
                              })()
                            : t('jobs.waitingForLogs', 'Waiting for output...')}
                          <div ref={logsEndRef} />
                        </Code>
                        {hasLogs &&
                          selectedJob.logs!.length > LOGS_TRUNCATE_LIMIT &&
                          !showAllLogs && (
                            <Button
                              variant="subtle"
                              size="compact-xs"
                              mt="xs"
                              onClick={() => setShowAllLogs(true)}
                            >
                              {t('jobs.showAllLogs', 'Show all')} ({selectedJob.logs!.length}{' '}
                              {t('jobs.lines', 'lines')})
                            </Button>
                          )}
                      </Collapse>
                    </div>
                  </>
                );
              })()}

              {/* Output section */}
              {selectedJob.outputPath && (
                <>
                  <Divider />
                  <div>
                    <Text fw={600} size="sm" c="dimmed" mb={4}>
                      {t('jobs.output', 'Output')}
                    </Text>
                    <Text
                      component="a"
                      href={`/data/${encodeURIComponent(selectedJob.outputPath)}`}
                      c="blue"
                      td="underline"
                      size="sm"
                    >
                      {relativizePath(selectedJob.outputPath, resolvedOutputDir)}
                    </Text>
                  </div>
                </>
              )}

              {/* Progress */}
              <Divider />
              <ProgressPanel jobId={selectedJob.id} />
            </Stack>
          )}
        </Drawer>
      </Stack>
    </Container>
  );
}
