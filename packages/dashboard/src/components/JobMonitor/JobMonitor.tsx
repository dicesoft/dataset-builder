import { useState } from 'react';
import {
  ActionIcon,
  Badge,
  Box,
  Collapse,
  Group,
  Paper,
  Progress,
  Stack,
  Text,
} from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { useTranslation } from 'react-i18next';
import { useJobStore, type JobRecord } from '@/stores/jobStore';

function MiniJobRow({ job }: { job: JobRecord }) {
  const [expanded, setExpanded] = useState(false);
  const { progress, status } = job;
  const percent =
    progress && progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0;

  return (
    <Box>
      <Group
        gap="xs"
        style={{ cursor: 'pointer' }}
        onClick={() => setExpanded((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setExpanded((v) => !v);
          }
        }}
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        aria-label={`${job.command} - ${status} ${percent}%`}
      >
        <Badge size="xs" color={status === 'running' ? 'blue' : 'gray'} variant="light">
          {status}
        </Badge>
        <Text size="xs" fw={500} style={{ flex: 1 }} truncate>
          {job.command}
        </Text>
        <Text size="xs" c="dimmed">
          {percent}%
        </Text>
      </Group>
      <Progress
        value={percent}
        size="xs"
        mt={4}
        animated={status === 'running'}
        aria-label={`${job.command} progress`}
      />
      <Collapse in={expanded}>
        <Stack gap={2} mt="xs" pl="xs">
          {progress?.phase && (
            <Text size="xs" c="dimmed">
              Phase: {progress.phase}
            </Text>
          )}
          {progress?.message && (
            <Text size="xs" c="dimmed">
              {progress.message}
            </Text>
          )}
          <Text size="xs" c="dimmed">
            {progress?.current ?? 0} / {progress?.total ?? '?'}
          </Text>
        </Stack>
      </Collapse>
    </Box>
  );
}

export function JobMonitor() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const isMobile = useMediaQuery('(max-width: 768px)');
  const jobs = useJobStore((s) => s.jobs);
  const activeJobIds = useJobStore((s) => s.activeJobIds);

  if (activeJobIds.size === 0) return null;

  const activeJobs: JobRecord[] = [];
  for (const id of activeJobIds) {
    const job = jobs.get(id);
    if (job) activeJobs.push(job);
  }

  return (
    <Box
      style={{
        position: 'fixed',
        bottom: isMobile ? 72 : 16,
        right: 16,
        zIndex: 1000,
        width: open ? 320 : 'auto',
      }}
    >
      {!open && (
        <ActionIcon
          variant="filled"
          color="blue"
          size="lg"
          radius="xl"
          onClick={() => setOpen(true)}
          aria-label="Show active jobs"
        >
          <Badge size="sm" color="white" variant="transparent" style={{ pointerEvents: 'none' }}>
            {activeJobs.length}
          </Badge>
        </ActionIcon>
      )}

      {open && (
        <Paper shadow="lg" p="sm" withBorder radius="md">
          <Group justify="space-between" mb="xs">
            <Text size="sm" fw={600}>
              {t('jobs.activeJobs')} ({activeJobs.length})
            </Text>
            <ActionIcon
              variant="subtle"
              size="sm"
              onClick={() => setOpen(false)}
              aria-label="Collapse job monitor"
            >
              &times;
            </ActionIcon>
          </Group>
          <Stack gap="sm">
            {activeJobs.map((job) => (
              <MiniJobRow key={job.id} job={job} />
            ))}
          </Stack>
        </Paper>
      )}
    </Box>
  );
}
