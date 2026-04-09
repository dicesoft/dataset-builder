import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  CloseButton,
  Container,
  Fieldset,
  Group,
  NumberInput,
  Select,
  Skeleton,
  Stack,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { useTranslation } from 'react-i18next';
import { apiGet } from '@/utils/api';
import { useJob } from '@/hooks/useJob';
import {
  FormBuilder,
  type CommandOption,
  type FieldGroup,
} from '@/components/FormBuilder/FormBuilder';
import { ProgressPanel } from '@/components/ProgressPanel/ProgressPanel';
import { DatasetSelector } from '@/components/DatasetSelector/DatasetSelector';
import { useMetadataStore } from '@/stores/metadataStore';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DatasetEntry {
  name: string;
  path: string;
  recordCount: number;
}

interface FormatInfo {
  name: string;
  description: string;
}

interface FormatsByCategory {
  text: FormatInfo[];
  vision: FormatInfo[];
  audio: FormatInfo[];
  huggingface: FormatInfo[];
}

interface FieldMapping {
  source: string;
  target: string;
}

// ---------------------------------------------------------------------------
// Field groups
// ---------------------------------------------------------------------------

function useFormatGroups(): FieldGroup[] {
  const { t } = useTranslation();
  return useMemo(
    () => [{ label: t('format.optionsGroup'), fields: ['model', 'batchSize', 'concurrency'] }],
    [t]
  );
}

/** Fields handled externally */
const EXTERNAL_FIELDS = new Set(['input', 'format', 'output', 'split', 'fieldMap']);

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function Format() {
  const { t } = useTranslation();
  const formatGroups = useFormatGroups();

  // Command schema from centralized metadataStore
  const commandMeta = useMetadataStore((s) => s.commandMetas.get('format') ?? null);
  const schemaLoading = useMetadataStore((s) => s.loading);
  const schemaError = useMetadataStore((s) =>
    !s.loading && !s.commandMetas.has('format') && !s.error
      ? 'Format command not found in server metadata'
      : s.error
  );

  // Datasets
  const [datasets, setDatasets] = useState<DatasetEntry[]>([]);
  const [datasetsError, setDatasetsError] = useState<string | null>(null);
  const [selectedDataset, setSelectedDataset] = useState<string | null>(null);

  // Local validation error (e.g. missing dataset selection) — mirrors the
  // Transform pattern from Phase 2.
  const [localError, setLocalError] = useState<string | null>(null);

  // Clear local validation error when a dataset is selected.
  useEffect(() => {
    if (selectedDataset) {
      setLocalError(null);
    }
  }, [selectedDataset]);

  // Formats
  const [formatsByCategory, setFormatsByCategory] = useState<FormatsByCategory | null>(null);
  const [selectedFormat, setSelectedFormat] = useState<string | null>(null);

  // Split ratio
  const [trainPct, setTrainPct] = useState<number | string>(80);
  const [valPct, setValPct] = useState<number | string>(10);
  const [testPct, setTestPct] = useState<number | string>(10);

  // Field mapping
  const [mappings, setMappings] = useState<FieldMapping[]>([]);

  // Dataset fields (for field mapping selectors)
  const [datasetFields, setDatasetFields] = useState<string[]>([]);

  // Job state
  const { submitJob, jobId, isSubmitting, error: submitError } = useJob();

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

  // Fetch formats
  useEffect(() => {
    let cancelled = false;

    async function loadFormats() {
      try {
        const data = await apiGet<{
          formats: FormatInfo[];
          byCategory: FormatsByCategory;
          count: number;
        }>('/api/v1/formats');
        if (!cancelled) setFormatsByCategory(data.byCategory);
      } catch {
        // Silently ignore
      }
    }

    loadFormats();
    return () => {
      cancelled = true;
    };
  }, []);

  // Fetch dataset fields when a dataset is selected
  useEffect(() => {
    if (!selectedDataset) {
      setDatasetFields([]);
      return;
    }

    let cancelled = false;

    async function loadFields() {
      try {
        const data = await apiGet<{ fields: string[] }>(
          `/api/v1/datasets/${encodeURIComponent(selectedDataset!)}/fields`
        );
        if (!cancelled) setDatasetFields(data.fields);
      } catch {
        if (!cancelled) setDatasetFields([]);
      }
    }

    loadFields();
    return () => {
      cancelled = true;
    };
  }, [selectedDataset]);

  // Field options for field mapping selectors
  const fieldOptions = useMemo(
    () => datasetFields.map((f) => ({ value: f, label: f })),
    [datasetFields]
  );

  // Format select data grouped by category
  const formatData = useMemo(() => {
    if (!formatsByCategory) return [];
    const groups: Array<{ group: string; items: Array<{ value: string; label: string }> }> = [];

    const categoryMap: Array<[keyof FormatsByCategory, string]> = [
      ['text', t('format.categoryText')],
      ['vision', t('format.categoryVision')],
      ['audio', t('format.categoryAudio')],
      ['huggingface', t('format.categoryHuggingface')],
    ];

    for (const [key, label] of categoryMap) {
      const items = formatsByCategory[key];
      if (items && items.length > 0) {
        groups.push({
          group: label,
          items: items.map((f) => ({ value: f.name, label: `${f.name} — ${f.description}` })),
        });
      }
    }

    return groups;
  }, [formatsByCategory, t]);

  // Filter out externally-handled fields
  const filteredOptions = useMemo(
    () => (commandMeta?.options ?? []).filter((o) => !EXTERNAL_FIELDS.has(o.name)),
    [commandMeta]
  );

  // Field mapping handlers
  const addMapping = useCallback(() => {
    setMappings((prev) => [...prev, { source: '', target: '' }]);
  }, []);

  const removeMapping = useCallback((index: number) => {
    setMappings((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const updateMapping = useCallback((index: number, field: 'source' | 'target', value: string) => {
    setMappings((prev) => prev.map((m, i) => (i === index ? { ...m, [field]: value } : m)));
  }, []);

  // Submit handler
  const handleSubmit = useCallback(
    async (values: Record<string, unknown>) => {
      // Mirror the Transform null-dataset guard (master-plan §3.1): surface
      // a localError before hitting the API, and do NOT submit.
      if (!selectedDataset) {
        setLocalError(t('transform.selectDatasetRequired', 'Please select a dataset first.'));
        return;
      }
      setLocalError(null);

      const splitStr = `${trainPct}:${valPct}:${testPct}`;

      // Build field map from mappings
      const fieldMap: Record<string, string> = {};
      for (const m of mappings) {
        if (m.source && m.target) {
          fieldMap[m.source] = m.target;
        }
      }

      await submitJob('format', {
        ...values,
        input: selectedDataset,
        format: selectedFormat,
        split: splitStr,
        ...(Object.keys(fieldMap).length > 0 ? { fieldMap: JSON.stringify(fieldMap) } : {}),
      });
    },
    [submitJob, selectedDataset, selectedFormat, trainPct, valPct, testPct, mappings, t]
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
            {t('format.title')}
          </Title>
          <Text c="dimmed" size="sm">
            {commandMeta?.description ?? t('format.description')}
          </Text>
        </div>

        {/* Dataset selector */}
        <DatasetSelector
          datasets={datasets}
          fetchError={datasetsError}
          value={selectedDataset}
          onChange={setSelectedDataset}
          label={t('format.selectDataset')}
          required
          error={
            localError && !selectedDataset
              ? t('transform.selectDatasetRequired', 'Please select a dataset first.')
              : undefined
          }
        />

        {/* Format selector grouped by category */}
        <Select
          label={t('format.selectFormat')}
          placeholder={t('format.selectFormat')}
          data={formatData}
          value={selectedFormat}
          onChange={setSelectedFormat}
          clearable
          searchable
        />

        {/* Split ratio */}
        <Fieldset legend={t('format.splitRatio')}>
          <Stack gap="sm">
            <Group grow>
              <NumberInput
                label={t('format.train')}
                value={trainPct}
                onChange={setTrainPct}
                min={0}
                max={100}
                suffix="%"
              />
              <NumberInput
                label={t('format.val')}
                value={valPct}
                onChange={setValPct}
                min={0}
                max={100}
                suffix="%"
              />
              <NumberInput
                label={t('format.test')}
                value={testPct}
                onChange={setTestPct}
                min={0}
                max={100}
                suffix="%"
              />
            </Group>
            {(() => {
              const sum = (Number(trainPct) || 0) + (Number(valPct) || 0) + (Number(testPct) || 0);
              if (sum !== 100) {
                return (
                  <Alert color="orange" variant="light">
                    {t('format.splitWarning', { sum })}
                  </Alert>
                );
              }
              return null;
            })()}
          </Stack>
        </Fieldset>

        {/* Field mapping editor */}
        <Fieldset legend={t('format.fieldMapping')}>
          <Stack gap="sm">
            {mappings.map((mapping, index) => (
              <Group key={index} grow>
                {fieldOptions.length > 0 ? (
                  <Select
                    placeholder={t('format.sourceField')}
                    data={fieldOptions}
                    value={mapping.source || null}
                    onChange={(val) => updateMapping(index, 'source', val ?? '')}
                    searchable
                    clearable
                  />
                ) : (
                  <TextInput
                    placeholder={t('format.sourceField')}
                    value={mapping.source}
                    onChange={(e) => updateMapping(index, 'source', e.currentTarget.value)}
                  />
                )}
                <TextInput
                  placeholder={t('format.targetField')}
                  value={mapping.target}
                  onChange={(e) => updateMapping(index, 'target', e.currentTarget.value)}
                />
                <CloseButton aria-label="Remove mapping" onClick={() => removeMapping(index)} />
              </Group>
            ))}
            <Button variant="light" size="xs" onClick={addMapping}>
              {t('format.addMapping')}
            </Button>
          </Stack>
        </Fieldset>

        {/* Progress panel */}
        {jobId && <ProgressPanel jobId={jobId} />}

        {/* Error alerts — render localError and submitError in separate slots
            so one never hides the other (mirrors Transform Phase 2.6). */}
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

        {/* Form for remaining options */}
        {commandMeta && (
          <FormBuilder
            commandName="format"
            options={filteredOptions}
            groups={formatGroups}
            onSubmit={handleSubmit}
            loading={isSubmitting}
            canSubmit={selectedDataset !== null}
          />
        )}
      </Stack>
    </Container>
  );
}
