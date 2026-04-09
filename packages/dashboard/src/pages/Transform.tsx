import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Badge,
  Container,
  Paper,
  Select,
  Skeleton,
  Stack,
  Table,
  Text,
  Title,
} from '@mantine/core';
import { useTranslation } from 'react-i18next';
import { apiGet } from '@/utils/api';
import { useJob } from '@/hooks/useJob';
import { useJobStore, type JobRecord } from '@/stores/jobStore';
import { useMetadataStore } from '@/stores/metadataStore';
import { useConfigStore } from '@/stores/configStore';
import { relativizePath } from '@/utils/paths';
import {
  FormBuilder,
  type CommandOption,
  type FieldGroup,
} from '@/components/FormBuilder/FormBuilder';
import { ProgressPanel } from '@/components/ProgressPanel/ProgressPanel';
import { DatasetSelector } from '@/components/DatasetSelector/DatasetSelector';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DatasetEntry {
  name: string;
  path: string;
  recordCount: number;
}

interface TemplateMeta {
  name: string;
  description: string;
  fields?: string[];
}

// ---------------------------------------------------------------------------
// Field groups
// ---------------------------------------------------------------------------

function useTransformGroups(): FieldGroup[] {
  const { t } = useTranslation();
  return useMemo(
    () => [
      {
        label: t('transform.optionsGroup'),
        fields: ['model', 'batchSize', 'concurrency', 'labelMode', 'noLlm'],
      },
    ],
    [t]
  );
}

/** Fields handled externally (dataset selector, template selector) */
const EXTERNAL_FIELDS = new Set(['input', 'template', 'output']);

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function Transform() {
  const { t } = useTranslation();
  const transformGroups = useTransformGroups();

  // Default model from config
  const ollamaModel = useConfigStore((s) => (s.config?.ollamaModel as string) ?? '');
  const resolvedOutputDir = useConfigStore((s) => s.resolvedOutputDir);

  // Command schema from centralized metadataStore
  const commandMeta = useMetadataStore((s) => s.commandMetas.get('transform') ?? null);
  const schemaLoading = useMetadataStore((s) => s.loading);
  const schemaError = useMetadataStore((s) =>
    !s.loading && !s.commandMetas.has('transform') && !s.error
      ? 'Transform command not found in server metadata'
      : s.error
  );

  // Datasets
  const [datasets, setDatasets] = useState<DatasetEntry[]>([]);
  const [datasetsError, setDatasetsError] = useState<string | null>(null);
  const [selectedDataset, setSelectedDataset] = useState<string | null>(null);

  // Templates
  const [templates, setTemplates] = useState<TemplateMeta[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null);

  // Job state
  const { submitJob, jobId, isSubmitting, error: submitError } = useJob();
  const job = useJobStore((s) => (jobId ? s.jobs.get(jobId) : undefined)) as JobRecord | undefined;

  // Local validation error (e.g. missing dataset selection)
  const [localError, setLocalError] = useState<string | null>(null);

  // Clear local validation error when a dataset is selected
  useEffect(() => {
    if (selectedDataset) {
      setLocalError(null);
    }
  }, [selectedDataset]);

  // Fetch datasets
  useEffect(() => {
    let cancelled = false;

    async function loadDatasets() {
      try {
        const data = await apiGet<{ datasets: DatasetEntry[] }>('/api/v1/datasets');
        if (!cancelled) {
          setDatasets(data.datasets);
          setDatasetsError(null);
        }
      } catch (err) {
        if (!cancelled) {
          const message = err instanceof Error ? err.message : String(err);
          setDatasetsError(message);
        }
      }
    }

    loadDatasets();
    return () => {
      cancelled = true;
    };
  }, []);

  // Fetch templates
  useEffect(() => {
    let cancelled = false;

    async function loadTemplates() {
      try {
        const data = await apiGet<{ command: string; templates: TemplateMeta[] }>(
          '/api/v1/commands/transform/templates'
        );
        if (!cancelled) setTemplates(data.templates);
      } catch {
        // Silently ignore
      }
    }

    loadTemplates();
    return () => {
      cancelled = true;
    };
  }, []);

  // Template select data
  const templateData = useMemo(
    () =>
      templates.map((tmpl) => ({
        value: tmpl.name,
        label: `${tmpl.name} — ${tmpl.description}`,
      })),
    [templates]
  );

  // Filter out externally-handled fields
  const filteredOptions = useMemo(
    () => (commandMeta?.options ?? []).filter((o) => !EXTERNAL_FIELDS.has(o.name)),
    [commandMeta]
  );

  // Submit handler
  const handleSubmit = useCallback(
    async (values: Record<string, unknown>) => {
      if (!selectedDataset) {
        setLocalError(t('transform.selectDatasetRequired', 'Please select a dataset first.'));
        return;
      }
      setLocalError(null);
      await submitJob('transform', {
        ...values,
        input: selectedDataset,
        template: selectedTemplate,
      });
    },
    [submitJob, selectedDataset, selectedTemplate, t]
  );

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  if (schemaLoading) {
    return (
      <Container size="lg" py="md">
        <Stack gap="lg">
          <Skeleton height={32} width={200} />
          <Skeleton height={36} width={300} />
          <Skeleton height={36} />
          <Skeleton height={36} />
          <Skeleton height={80} />
          <Skeleton height={40} width={120} />
        </Stack>
      </Container>
    );
  }

  if (schemaError) {
    return (
      <Container size="lg" py="md">
        <Alert color="red" title={t('common.error')}>
          {schemaError}
        </Alert>
      </Container>
    );
  }

  return (
    <Container size="lg" py="md">
      <Stack gap="lg">
        <div>
          <Title order={2} mb={4}>
            {t('transform.title')}
          </Title>
          <Text c="dimmed" size="sm">
            {commandMeta?.description ?? t('transform.description')}
          </Text>
        </div>

        {/* Dataset selector */}
        <DatasetSelector
          datasets={datasets}
          fetchError={datasetsError}
          value={selectedDataset}
          onChange={setSelectedDataset}
          label={t('transform.selectDataset')}
          required
          error={
            localError && !selectedDataset
              ? t('transform.selectDatasetRequired', 'Please select a dataset first.')
              : undefined
          }
        />

        {/* Template selector */}
        <Select
          label={t('transform.selectTemplate')}
          placeholder={t('transform.noTemplates')}
          data={templateData}
          value={selectedTemplate}
          onChange={setSelectedTemplate}
          clearable
          searchable
        />

        {/* Error alerts — render localError and submitError in separate slots
            so one never hides the other. */}
        {localError && (
          <Alert color="red" title={t('common.error')} role="alert">
            {localError}
          </Alert>
        )}
        {submitError && (
          <Alert color="red" title={t('common.error')} role="alert">
            {submitError}
          </Alert>
        )}

        {/* Progress panel — hide its counters; Transform renders its own decision-log table. */}
        {jobId && <ProgressPanel jobId={jobId} hideCounters />}

        {/* Decision log viewer — shown after job completes */}
        {job?.status === 'completed' && job.progress?.counters && (
          <Paper p="md" withBorder>
            <Stack gap="sm">
              <Text size="sm" fw={600}>
                {t('transform.decisionLog', 'Decision Log')}
              </Text>
              <Table striped highlightOnHover withTableBorder>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>{t('common.metric', 'Metric')}</Table.Th>
                    <Table.Th>{t('common.count', 'Count')}</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {Object.entries(job.progress.counters).map(([key, val]) => {
                    const lower = key.toLowerCase();
                    const isAccept = lower.includes('accept') || lower.includes('success');
                    const isReject =
                      lower.includes('reject') || lower.includes('fail') || lower.includes('error');
                    const isSkip = lower.includes('skip');
                    const color = isAccept
                      ? 'green'
                      : isReject
                        ? 'red'
                        : isSkip
                          ? 'yellow'
                          : 'gray';
                    // Non-color channel (colorblind-safe): symbol prefix.
                    const prefix = isAccept
                      ? '✓ accepted '
                      : isReject
                        ? '✗ rejected '
                        : isSkip
                          ? '⚠ skipped '
                          : '';
                    return (
                      <Table.Tr key={key}>
                        <Table.Td>
                          <Badge variant="light" size="sm" color={color}>
                            {prefix}
                            {key}
                          </Badge>
                        </Table.Td>
                        <Table.Td>{val}</Table.Td>
                      </Table.Tr>
                    );
                  })}
                  {job.progress.total > 0 && (
                    <Table.Tr>
                      <Table.Td>
                        <Text size="sm" fw={600}>
                          {t('common.total')}
                        </Text>
                      </Table.Td>
                      <Table.Td>
                        <Text size="sm" fw={600}>
                          {job.progress.current} / {job.progress.total}
                        </Text>
                      </Table.Td>
                    </Table.Tr>
                  )}
                </Table.Tbody>
              </Table>
              {job.outputPath && (
                <Text size="xs" c="dimmed">
                  {t('transform.outputAt', 'Output at')}:{' '}
                  {relativizePath(job.outputPath, resolvedOutputDir)}
                </Text>
              )}
            </Stack>
          </Paper>
        )}

        {/* Form for remaining options */}
        {commandMeta && (
          <FormBuilder
            commandName="transform"
            options={filteredOptions}
            groups={transformGroups}
            onSubmit={handleSubmit}
            loading={isSubmitting}
            initialValues={ollamaModel ? { model: ollamaModel } : undefined}
            canSubmit={selectedDataset !== null}
          />
        )}
      </Stack>
    </Container>
  );
}
