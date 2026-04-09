/**
 * T049: DataBrowser page
 * Lists datasets with file type icons, record counts, sizes, and dates.
 * Click a dataset to navigate to /data/:path viewer.
 */

import { useEffect, useState, useMemo } from 'react';
import {
  Container,
  Title,
  TextInput,
  Table,
  Badge,
  Text,
  Card,
  Group,
  Stack,
  Skeleton,
  Button,
  Code,
} from '@mantine/core';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useDataset, type DatasetInfo } from '@/hooks/useDataset';
import { useConfigStore } from '@/stores/configStore';

const typeIcons: Record<string, string> = {
  json: '{}',
  jsonl: '[]',
  csv: ',',
};

const typeColors: Record<string, string> = {
  json: 'blue',
  jsonl: 'teal',
  csv: 'orange',
};

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function DataBrowser() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { datasets, loading, error, fetchDatasets } = useDataset();
  const resolvedOutputDir = useConfigStore((s) => s.resolvedOutputDir);
  const fetchConfig = useConfigStore((s) => s.fetchConfig);
  const [search, setSearch] = useState('');

  useEffect(() => {
    fetchConfig().catch(() => {});
  }, [fetchConfig]);

  useEffect(() => {
    fetchDatasets();
  }, [fetchDatasets]);

  const filtered = useMemo(() => {
    if (!search.trim()) return datasets;
    const q = search.toLowerCase();
    return datasets.filter(
      (d) =>
        d.name.toLowerCase().includes(q) ||
        d.path.toLowerCase().includes(q) ||
        d.type.toLowerCase().includes(q)
    );
  }, [datasets, search]);

  const handleRowClick = (dataset: DatasetInfo) => {
    navigate(`/data/${encodeURIComponent(dataset.path)}`);
  };

  if (loading && datasets.length === 0) {
    return (
      <Container size="lg" py="md">
        <Title order={2} mb="lg">
          {t('dataViewer.title')}
        </Title>
        <Skeleton height={36} mb="md" />
        <Table striped withTableBorder>
          <Table.Thead>
            <Table.Tr>
              {Array.from({ length: 7 }).map((_, i) => (
                <Table.Th key={i}>
                  <Skeleton height={14} />
                </Table.Th>
              ))}
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {Array.from({ length: 5 }).map((_, row) => (
              <Table.Tr key={row}>
                {Array.from({ length: 7 }).map((_, col) => (
                  <Table.Td key={col}>
                    <Skeleton height={14} />
                  </Table.Td>
                ))}
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Container>
    );
  }

  return (
    <Container size="lg" py="md">
      <Title order={2} mb="sm">
        {t('dataViewer.title')}
      </Title>

      {resolvedOutputDir && (
        <Group gap="xs" mb="md">
          <Text size="sm" c="dimmed">
            {t('dataViewer.rootDirectory')}:
          </Text>
          <Code>{resolvedOutputDir}</Code>
        </Group>
      )}

      {error && (
        <Card withBorder p="md" mb="md" bg="red.0">
          <Text c="red" size="sm">
            {error}
          </Text>
        </Card>
      )}

      <TextInput
        placeholder={t('dataViewer.searchPlaceholder')}
        value={search}
        onChange={(e) => setSearch(e.currentTarget.value)}
        mb="md"
      />

      {filtered.length === 0 ? (
        <Card withBorder p="xl" ta="center">
          <Stack gap="md" align="center">
            <Text size="2rem">{datasets.length === 0 ? '📂' : '🔍'}</Text>
            <Text size="xl" fw={500}>
              {t('dataViewer.noDatasets')}
            </Text>
            <Text size="sm" c="dimmed" maw={400}>
              {datasets.length === 0 ? t('dataViewer.createPrompt') : t('dataViewer.noMatch')}
            </Text>
            {datasets.length === 0 && (
              <Group>
                <Button onClick={() => navigate('/scrape')} variant="light">
                  {t('dashboard.startScrape')}
                </Button>
                <Button onClick={() => navigate('/generate')} variant="subtle">
                  {t('dashboard.startGenerate')}
                </Button>
                <Button onClick={() => navigate('/import')} variant="subtle">
                  {t('dashboard.startImport')}
                </Button>
              </Group>
            )}
          </Stack>
        </Card>
      ) : (
        <Table striped highlightOnHover withTableBorder>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>{t('dataViewer.type')}</Table.Th>
              <Table.Th>{t('dataViewer.name')}</Table.Th>
              <Table.Th>{t('dataViewer.path')}</Table.Th>
              <Table.Th ta="right">{t('dataViewer.records')}</Table.Th>
              <Table.Th ta="right">{t('dataViewer.size')}</Table.Th>
              <Table.Th>{t('dataViewer.modified')}</Table.Th>
              <Table.Th>{t('dataViewer.fields')}</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {filtered.map((dataset) => (
              <Table.Tr
                key={dataset.path}
                style={{ cursor: 'pointer' }}
                onClick={() => handleRowClick(dataset)}
              >
                <Table.Td>
                  <Badge color={typeColors[dataset.type] ?? 'gray'} variant="light" size="sm">
                    {typeIcons[dataset.type] ?? '?'} {dataset.type.toUpperCase()}
                  </Badge>
                </Table.Td>
                <Table.Td>
                  <Text fw={500} size="sm">
                    {dataset.name}
                  </Text>
                </Table.Td>
                <Table.Td>
                  <Text
                    size="xs"
                    c="dimmed"
                    style={{
                      maxWidth: 200,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {dataset.path}
                  </Text>
                </Table.Td>
                <Table.Td ta="right">
                  <Text size="sm">{dataset.recordCount.toLocaleString()}</Text>
                </Table.Td>
                <Table.Td ta="right">
                  <Text size="sm">{formatSize(dataset.size)}</Text>
                </Table.Td>
                <Table.Td>
                  <Text size="xs" c="dimmed">
                    {formatDate(dataset.modifiedAt)}
                  </Text>
                </Table.Td>
                <Table.Td>
                  <Group gap={4}>
                    {dataset.fields.slice(0, 3).map((f) => (
                      <Badge key={f} size="xs" variant="outline" color="gray">
                        {f}
                      </Badge>
                    ))}
                    {dataset.fields.length > 3 && (
                      <Badge size="xs" variant="outline" color="gray">
                        +{dataset.fields.length - 3}
                      </Badge>
                    )}
                  </Group>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}
    </Container>
  );
}
