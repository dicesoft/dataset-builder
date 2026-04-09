import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Container,
  Button,
  Group,
  Loader,
  MultiSelect,
  Paper,
  Progress,
  Select,
  Stack,
  Switch,
  Text,
  Title,
} from '@mantine/core';
import { useTranslation } from 'react-i18next';
import { apiGet } from '@/utils/api';
import { useDataset } from '@/hooks/useDataset';
import { useJob } from '@/hooks/useJob';
import { useJobStore, type JobRecord } from '@/stores/jobStore';
import { useMetadataStore } from '@/stores/metadataStore';
import { useConfigStore } from '@/stores/configStore';
import { ProgressPanel } from '@/components/ProgressPanel/ProgressPanel';
import { DatasetSelector } from '@/components/DatasetSelector/DatasetSelector';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Language {
  code: string;
  name: string;
  nativeName?: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function Translate() {
  const { t } = useTranslation();
  const { submitJob, jobId, isSubmitting, error: submitError } = useJob();
  const { datasets, loading: datasetsLoading, error: datasetsError, fetchDatasets } = useDataset();
  const job = useJobStore((s) => (jobId ? s.jobs.get(jobId) : undefined)) as JobRecord | undefined;

  // Dataset selection
  const [selectedDataset, setSelectedDataset] = useState<string | null>(null);

  // Languages
  const [languages, setLanguages] = useState<Language[]>([]);
  const [languagesLoading, setLanguagesLoading] = useState(true);
  const [selectedLanguages, setSelectedLanguages] = useState<string[]>([]);

  // Model selection — default to ollamaModel from config
  const ollamaModel = useConfigStore((s) => (s.config?.ollamaModel as string) ?? '');
  const [selectedModel, setSelectedModel] = useState<string | null>(null);
  const models = useMetadataStore((s) => s.models);
  const modelOptions = useMemo(
    () => models.map((m) => ({ value: m.name, label: m.name })),
    [models]
  );

  // Field toggles
  const [fieldExclusions, setFieldExclusions] = useState<Set<string>>(new Set());

  // Output mode
  const [perLanguageOutput, setPerLanguageOutput] = useState(true);

  // Selected dataset info
  const selectedDatasetInfo = useMemo(
    () => datasets.find((d) => d.path === selectedDataset),
    [datasets, selectedDataset]
  );

  // Default model from config
  useEffect(() => {
    if (ollamaModel && !selectedModel) {
      setSelectedModel(ollamaModel);
    }
  }, [ollamaModel]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch datasets on mount
  useEffect(() => {
    fetchDatasets();
  }, [fetchDatasets]);

  // Fetch languages on mount
  useEffect(() => {
    let cancelled = false;
    async function loadLanguages() {
      try {
        const data = await apiGet<{ languages: Language[]; count: number }>('/api/v1/languages');
        if (!cancelled) setLanguages(data.languages);
      } catch {
        // Non-fatal
      } finally {
        if (!cancelled) setLanguagesLoading(false);
      }
    }
    loadLanguages();
    return () => {
      cancelled = true;
    };
  }, []);

  // Language select data
  const languageOptions = useMemo(
    () =>
      languages.map((l) => ({
        value: l.code,
        label: l.nativeName ? `${l.name} (${l.nativeName})` : l.name,
      })),
    [languages]
  );

  // Toggle field inclusion/exclusion
  const toggleField = useCallback((field: string) => {
    setFieldExclusions((prev) => {
      const next = new Set(prev);
      if (next.has(field)) {
        next.delete(field);
      } else {
        next.add(field);
      }
      return next;
    });
  }, []);

  // Submit handler
  const handleSubmit = useCallback(async () => {
    if (!selectedDataset || selectedLanguages.length === 0) return;

    const excludeFields = [...fieldExclusions];
    await submitJob('translate', {
      input: selectedDataset,
      languages: selectedLanguages,
      ...(selectedModel ? { model: selectedModel } : {}),
      ...(excludeFields.length > 0 ? { excludeFields } : {}),
      perLanguage: perLanguageOutput,
    });
  }, [
    submitJob,
    selectedDataset,
    selectedLanguages,
    selectedModel,
    fieldExclusions,
    perLanguageOutput,
  ]);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <Container size="lg" py="md">
      <Stack gap="lg">
        <div>
          <Title order={2} mb={4}>
            {t('translate.title')}
          </Title>
          <Text c="dimmed" size="sm">
            {t('translate.description')}
          </Text>
        </div>

        {/* Error alert */}
        {submitError && (
          <Alert color="red" title={t('common.error')}>
            {submitError}
          </Alert>
        )}

        {/* Progress panel */}
        {jobId && <ProgressPanel jobId={jobId} />}

        {/* Per-language progress bars */}
        {job &&
          (job.status === 'running' || job.status === 'completed') &&
          selectedLanguages.length > 0 && (
            <Paper p="md" withBorder>
              <Stack gap="sm">
                <Text size="sm" fw={600}>
                  {t('translate.perLanguageProgress', 'Per-Language Progress')}
                </Text>
                {selectedLanguages.map((langCode) => {
                  const langLabel = languages.find((l) => l.code === langCode)?.name ?? langCode;
                  const counters = job.progress?.counters ?? {};
                  // Check for per-language counters (e.g., lang_es, lang_fr)
                  const langDone =
                    (counters[`lang_${langCode}`] as number) ?? (counters[langCode] as number) ?? 0;
                  const totalRecords = job.progress?.total ?? 0;
                  // If no per-language counter, fall back to overall progress divided by language count
                  const effectiveDone =
                    langDone > 0
                      ? langDone
                      : job.status === 'completed'
                        ? totalRecords
                        : Math.floor((job.progress?.current ?? 0) / selectedLanguages.length);
                  const pct =
                    totalRecords > 0
                      ? Math.min(100, Math.round((effectiveDone / totalRecords) * 100))
                      : job.status === 'completed'
                        ? 100
                        : 0;

                  return (
                    <div key={langCode}>
                      <Group justify="space-between" mb={4}>
                        <Text size="xs" fw={500}>
                          {langLabel}
                        </Text>
                        <Text size="xs" c="dimmed">
                          {pct}%
                        </Text>
                      </Group>
                      <Progress
                        value={pct}
                        size="sm"
                        radius="md"
                        color={pct === 100 ? 'green' : 'blue'}
                        animated={pct < 100 && job.status === 'running'}
                      />
                    </div>
                  );
                })}
              </Stack>
            </Paper>
          )}

        {/* Dataset selector */}
        <DatasetSelector
          datasets={datasets}
          isLoading={datasetsLoading}
          fetchError={datasetsError}
          value={selectedDataset}
          onChange={setSelectedDataset}
          label={t('translate.selectDataset')}
          required
          suppressEmptyStateWhileLoading
        />

        {/* Language multi-select */}
        <MultiSelect
          label={t('translate.selectLanguages')}
          placeholder={t('translate.selectLanguagesPlaceholder')}
          data={languageOptions}
          value={selectedLanguages}
          onChange={setSelectedLanguages}
          searchable
          clearable
          maxDropdownHeight={300}
          rightSection={languagesLoading ? <Loader size="xs" /> : undefined}
        />

        {/* Model selector */}
        <Select
          label={t('translate.model', 'Model')}
          description={t('translate.modelDescription', 'LLM model to use for translation')}
          placeholder={t('translate.selectModel', 'Select model')}
          data={modelOptions}
          value={selectedModel}
          onChange={setSelectedModel}
          searchable
          clearable
        />

        {/* Field inclusion/exclusion toggles */}
        {selectedDatasetInfo && selectedDatasetInfo.fields.length > 0 && (
          <Stack gap="xs">
            <Text size="sm" fw={500}>
              {t('translate.fieldInclusion')}
            </Text>
            {selectedDatasetInfo.fields.map((field) => (
              <Switch
                key={field}
                label={field}
                description={
                  fieldExclusions.has(field)
                    ? t('translate.excludeField')
                    : t('translate.includeField')
                }
                checked={!fieldExclusions.has(field)}
                onChange={() => toggleField(field)}
              />
            ))}
          </Stack>
        )}

        {/* Output mode toggle */}
        <Switch
          label={t('translate.outputMode')}
          description={perLanguageOutput ? t('translate.perLanguage') : t('translate.merged')}
          checked={perLanguageOutput}
          onChange={(e) => setPerLanguageOutput(e.currentTarget.checked)}
        />

        {/* Action buttons */}
        <Group justify="flex-end">
          <Button
            variant="default"
            onClick={() => {
              setSelectedDataset(null);
              setSelectedLanguages([]);
              setSelectedModel(null);
              setFieldExclusions(new Set());
              setPerLanguageOutput(true);
            }}
          >
            {t('common.reset')}
          </Button>
          <Button
            onClick={handleSubmit}
            loading={isSubmitting}
            disabled={!selectedDataset || selectedLanguages.length === 0}
          >
            {t('common.submit')}
          </Button>
        </Group>
      </Stack>
    </Container>
  );
}
