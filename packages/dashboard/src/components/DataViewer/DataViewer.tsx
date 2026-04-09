/**
 * T053: DataViewer container
 * Tabs to switch between Table and Gallery views.
 * Manages dataset path from URL params and fetches records.
 */

import { useEffect, useState, useCallback, useMemo } from 'react';
import {
  Container,
  Title,
  Tabs,
  Text,
  Loader,
  Center,
  Group,
  Badge,
  Card,
  Stack,
  TextInput,
  Button,
} from '@mantine/core';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useDataset } from '@/hooks/useDataset';
import { DataTable } from './DataTable';
import { GalleryView } from './GalleryView';
import { RecordDetail } from './RecordDetail';

const MEDIA_FIELD_PATTERNS = [
  /image/i,
  /photo/i,
  /thumbnail/i,
  /avatar/i,
  /cover/i,
  /poster/i,
  /url/i,
  /src/i,
  /path/i,
  /file/i,
  /media/i,
];

const IMAGE_EXTENSIONS = /\.(jpg|jpeg|png|gif|webp|svg)(\?|$)/i;

/**
 * Auto-detect fields that likely contain media URLs.
 */
function detectMediaFields(fields: string[], records: Record<string, unknown>[]): string[] {
  const candidates = new Set<string>();

  // Check field names against patterns
  for (const field of fields) {
    if (MEDIA_FIELD_PATTERNS.some((p) => p.test(field))) {
      candidates.add(field);
    }
  }

  // Also check actual values in first few records for image extensions
  const sample = records.slice(0, 5);
  for (const record of sample) {
    for (const field of fields) {
      const value = record[field];
      if (typeof value === 'string' && IMAGE_EXTENSIONS.test(value)) {
        candidates.add(field);
      } else if (Array.isArray(value)) {
        // Unwrap arrays of strings (e.g. files: ["https://...jpg", ...])
        for (const item of value) {
          if (typeof item === 'string' && IMAGE_EXTENSIONS.test(item)) {
            candidates.add(field);
            break;
          }
        }
      }
    }
  }

  return Array.from(candidates);
}

export function DataViewer() {
  const { t } = useTranslation();
  const { path: encodedPath } = useParams<{ path: string }>();
  const navigate = useNavigate();
  const { records, total, fields, loading, error, fetchRecords } = useDataset();

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [sort, setSort] = useState<string | undefined>();
  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState<string | null>('table');
  const [selectedRecord, setSelectedRecord] = useState<Record<string, unknown> | null>(null);

  const datasetPath = encodedPath ? decodeURIComponent(encodedPath) : '';

  const loadRecords = useCallback(() => {
    if (!datasetPath) return;
    fetchRecords(datasetPath, page, pageSize, sort, undefined, search || undefined);
  }, [datasetPath, page, pageSize, sort, search, fetchRecords]);

  useEffect(() => {
    loadRecords();
  }, [loadRecords]);

  const mediaFields = useMemo(() => detectMediaFields(fields, records), [fields, records]);

  const handlePageChange = useCallback((newPage: number, newPageSize: number) => {
    setPage(newPage);
    setPageSize(newPageSize);
  }, []);

  const handleSort = useCallback((newSort: string | undefined) => {
    setSort(newSort);
    setPage(1);
  }, []);

  const handleSearch = useCallback(() => {
    setPage(1);
    loadRecords();
  }, [loadRecords]);

  const handleRowClick = useCallback((record: Record<string, unknown>) => {
    setSelectedRecord(record);
  }, []);

  if (!datasetPath) {
    return (
      <Container size="lg" py="md">
        <Card withBorder p="xl" ta="center">
          <Text c="dimmed">{t('common.noDatasetSelected')}</Text>
          <Button variant="light" mt="sm" onClick={() => navigate('/data')}>
            {t('common.browseDatasets')}
          </Button>
        </Card>
      </Container>
    );
  }

  return (
    <Container size="xl" py="md">
      <Group justify="space-between" mb="md">
        <Group gap="sm">
          <Button variant="subtle" size="sm" onClick={() => navigate('/data')}>
            {t('common.back')}
          </Button>
          <Title order={3}>{datasetPath.split('/').pop()}</Title>
          <Badge variant="light" color="gray" size="sm">
            {total.toLocaleString()} {t('common.records')}
          </Badge>
        </Group>
      </Group>

      {error && (
        <Card withBorder p="md" mb="md" bg="red.0">
          <Text c="red" size="sm">
            {error}
          </Text>
        </Card>
      )}

      <Group mb="md" gap="sm">
        <TextInput
          placeholder={t('common.searchRecords')}
          value={search}
          onChange={(e) => setSearch(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleSearch();
          }}
          style={{ flex: 1 }}
        />
        <Button variant="light" onClick={handleSearch}>
          {t('common.search')}
        </Button>
      </Group>

      <Tabs value={activeTab} onChange={setActiveTab}>
        <Tabs.List mb="md">
          <Tabs.Tab value="table">{t('common.table')}</Tabs.Tab>
          <Tabs.Tab value="gallery" disabled={mediaFields.length === 0}>
            {t('common.gallery')}{' '}
            {mediaFields.length > 0 &&
              `(${t('common.mediaFields', { count: mediaFields.length })})`}
          </Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="table" style={{ overflow: 'hidden', maxWidth: '100%' }}>
          {loading ? (
            <Center py="xl">
              <Loader size="lg" />
            </Center>
          ) : (
            <DataTable
              records={records}
              fields={fields}
              total={total}
              page={page}
              pageSize={pageSize}
              onPageChange={handlePageChange}
              onSort={handleSort}
              onRowClick={handleRowClick}
            />
          )}
        </Tabs.Panel>

        <Tabs.Panel value="gallery">
          {loading ? (
            <Center py="xl">
              <Loader size="lg" />
            </Center>
          ) : (
            <GalleryView records={records} mediaFields={mediaFields} datasetPath={datasetPath} />
          )}
        </Tabs.Panel>
      </Tabs>

      <RecordDetail record={selectedRecord} onClose={() => setSelectedRecord(null)} />
    </Container>
  );
}
