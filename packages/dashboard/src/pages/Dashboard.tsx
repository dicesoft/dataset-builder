import { useEffect, useMemo, useState } from 'react';
import {
  SimpleGrid,
  Card,
  Text,
  Badge,
  Title,
  Container,
  Group,
  Stack,
  Button,
  Skeleton,
  Loader,
  Code,
} from '@mantine/core';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useJobStore, type JobRecord } from '@/stores/jobStore';
import { useConfigStore } from '@/stores/configStore';
import { apiGet } from '@/utils/api';

function countByStatus(jobs: Map<string, JobRecord>) {
  const counts: Record<string, number> = {};
  for (const job of jobs.values()) {
    counts[job.status] = (counts[job.status] || 0) + 1;
  }
  return counts;
}

const statusColors: Record<string, string> = {
  pending: 'yellow',
  queued: 'yellow',
  running: 'blue',
  completed: 'green',
  failed: 'red',
  cancelled: 'gray',
};

export default function Dashboard() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const jobs = useJobStore((s) => s.jobs);
  const fetchJobs = useJobStore((s) => s.fetchJobs);
  const resolvedOutputDir = useConfigStore((s) => s.resolvedOutputDir);
  const fetchConfig = useConfigStore((s) => s.fetchConfig);
  const [loading, setLoading] = useState(true);
  const [datasetCount, setDatasetCount] = useState<number | null>(null);
  const [datasetLoading, setDatasetLoading] = useState(true);

  useEffect(() => {
    fetchConfig().catch(() => {});
  }, [fetchConfig]);

  useEffect(() => {
    fetchJobs()
      .catch(() => {
        // API may not be available yet — silently ignore
      })
      .finally(() => setLoading(false));
  }, [fetchJobs]);

  useEffect(() => {
    apiGet<{ datasets: { name: string }[] }>('/api/v1/datasets')
      .then((data) => setDatasetCount(data.datasets.length))
      .catch(() => setDatasetCount(null))
      .finally(() => setDatasetLoading(false));
  }, []);

  const statusCounts = useMemo(() => countByStatus(jobs), [jobs]);
  const totalJobs = jobs.size;

  return (
    <Container size="lg" py="md">
      <Title order={2} mb="lg">
        {t('dashboard.title')}
      </Title>

      {resolvedOutputDir && (
        <Card withBorder p="sm" mb="lg" bg="var(--mantine-color-blue-light)">
          <Group gap="xs">
            <Text size="sm" fw={500}>
              {t('dashboard.outputDirectory')}:
            </Text>
            <Code>{resolvedOutputDir}</Code>
          </Group>
        </Card>
      )}

      {loading ? (
        <SimpleGrid cols={{ base: 1, xs: 2, md: 4 }} mb="lg">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i} withBorder p="md">
              <Group justify="space-between" mb="xs">
                <Skeleton height={14} width={80} />
                <Skeleton height={20} width={30} radius="xl" />
              </Group>
              <Skeleton height={28} width={40} mt="xs" />
            </Card>
          ))}
        </SimpleGrid>
      ) : totalJobs === 0 ? (
        <Card withBorder p="xl" ta="center">
          <Stack gap="md" align="center">
            <Text size="2rem">🚀</Text>
            <Title order={3}>{t('dashboard.getStartedTitle')}</Title>
            <Text size="sm" c="dimmed" maw={400}>
              {t('dashboard.noJobs')}
            </Text>
            <Group>
              <Button onClick={() => navigate('/scrape')} size="md">
                {t('dashboard.startScrape')}
              </Button>
              <Button onClick={() => navigate('/generate')} variant="light" size="md">
                {t('dashboard.startGenerate')}
              </Button>
              <Button onClick={() => navigate('/import')} variant="subtle" size="md">
                {t('dashboard.startImport')}
              </Button>
            </Group>
          </Stack>
        </Card>
      ) : (
        <>
          <Title order={4} mb="sm">
            {t('dashboard.recentJobs')}
          </Title>
          <SimpleGrid cols={{ base: 1, xs: 2, md: 4 }} mb="lg">
            {Object.entries(statusCounts).map(([status, count]) => (
              <Card key={status} withBorder p="md">
                <Group justify="space-between" mb="xs">
                  <Text size="sm" tt="capitalize" fw={500}>
                    {t(`jobs.status.${status}`, status)}
                  </Text>
                  <Badge color={statusColors[status] ?? 'gray'} variant="light">
                    {count}
                  </Badge>
                </Group>
                <Text size="xl" fw={700}>
                  {count}
                </Text>
              </Card>
            ))}
            <Card withBorder p="md">
              <Group justify="space-between" mb="xs">
                <Text size="sm" fw={500}>
                  {t('common.total')}
                </Text>
                <Badge color="violet" variant="light">
                  {totalJobs}
                </Badge>
              </Group>
              <Text size="xl" fw={700}>
                {totalJobs}
              </Text>
            </Card>
          </SimpleGrid>
        </>
      )}

      <SimpleGrid cols={{ base: 1, xs: 2, md: 3 }} mt="lg">
        <Card withBorder p="md">
          <Stack gap="xs">
            <Text size="sm" c="dimmed" fw={500}>
              {t('dashboard.datasets')}
            </Text>
            <Text size="xl" fw={700}>
              {datasetLoading ? <Loader size="xs" /> : datasetCount !== null ? datasetCount : '--'}
            </Text>
            <Text size="xs" c="dimmed">
              {t('dashboard.datasetsPlaceholder')}
            </Text>
          </Stack>
        </Card>

        <Card withBorder p="md">
          <Stack gap="xs">
            <Text size="sm" c="dimmed" fw={500}>
              {t('dashboard.dependencies')}
            </Text>
            <Text size="xs" c="dimmed">
              {t('dashboard.dependenciesHint')}
            </Text>
          </Stack>
        </Card>
      </SimpleGrid>
    </Container>
  );
}
