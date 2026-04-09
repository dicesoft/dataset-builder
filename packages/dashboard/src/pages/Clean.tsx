import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Collapse,
  Container,
  Fieldset,
  Group,
  NumberInput,
  SegmentedControl,
  Skeleton,
  Stack,
  Switch,
  TagsInput,
  Text,
  Title,
} from '@mantine/core';
import { useTranslation } from 'react-i18next';
import { apiGet } from '@/utils/api';
import { useJob } from '@/hooks/useJob';
import { ProgressPanel } from '@/components/ProgressPanel/ProgressPanel';
import { DatasetSelector } from '@/components/DatasetSelector/DatasetSelector';
import { useJobStore, type JobRecord } from '@/stores/jobStore';
import { useMetadataStore } from '@/stores/metadataStore';

interface DatasetEntry {
  name: string;
  path: string;
  recordCount: number;
}

interface CleaningConfig {
  strictness: 'low' | 'medium' | 'high';
  targetFields: string[];
  concurrency: number | string;
}

// ---------------------------------------------------------------------------
// Cleaning options definitions
// ---------------------------------------------------------------------------

const CLEANING_OPTIONS_KEYS = [
  'dedupe',
  'trim',
  'lowercase',
  'llmFilter',
  'visionFilter',
  'nsfwCheck',
  'imageDedupe',
  'mathVerify',
  'factCheck',
] as const;

type CleaningKey = (typeof CLEANING_OPTIONS_KEYS)[number];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function Clean() {
  const { t } = useTranslation();

  // Command schema from centralized metadataStore
  const commandMeta = useMetadataStore((s) => s.commandMetas.get('clean') ?? null);
  const schemaLoading = useMetadataStore((s) => s.loading);
  const schemaError = useMetadataStore((s) =>
    !s.loading && !s.commandMetas.has('clean') && !s.error
      ? 'Clean command not found in server metadata'
      : s.error
  );

  // Datasets
  const [datasets, setDatasets] = useState<DatasetEntry[]>([]);
  const [datasetsError, setDatasetsError] = useState<string | null>(null);
  const [selectedDataset, setSelectedDataset] = useState<string | null>(null);

  // Cleaning toggles
  const [toggles, setToggles] = useState<Record<CleaningKey, boolean>>({
    dedupe: false,
    trim: false,
    lowercase: false,
    llmFilter: false,
    visionFilter: false,
    nsfwCheck: false,
    imageDedupe: false,
    mathVerify: false,
    factCheck: false,
  });

  // Per-option config
  const [configs, setConfigs] = useState<Record<CleaningKey, CleaningConfig>>(
    Object.fromEntries(
      CLEANING_OPTIONS_KEYS.map((key) => [
        key,
        { strictness: 'medium' as const, targetFields: [] as string[], concurrency: 4 },
      ])
    ) as Record<CleaningKey, CleaningConfig>
  );

  // Job state
  const { submitJob, jobId, isSubmitting, error: submitError } = useJob();
  const completedJob = useJobStore((s) =>
    jobId ? (s.jobs.get(jobId) as JobRecord | undefined) : undefined
  );

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

  // Toggle handler
  const handleToggle = useCallback((key: CleaningKey, checked: boolean) => {
    setToggles((prev) => ({ ...prev, [key]: checked }));
  }, []);

  // Config update handler
  const handleConfigChange = useCallback(
    (key: CleaningKey, field: keyof CleaningConfig, value: string | number | string[]) => {
      setConfigs((prev) => ({
        ...prev,
        [key]: { ...prev[key], [field]: value },
      }));
    },
    []
  );

  // Enabled options count
  const enabledCount = useMemo(() => Object.values(toggles).filter(Boolean).length, [toggles]);

  // Submit handler
  //
  // Maps the dashboard's internal toggle keys to the flags that
  // `src/cli/commands/clean.ts` actually declares. The executor converts
  // camelCase keys to kebab-case flags, so each key emitted below must match
  // Commander's camelCase for an existing `.option()` declaration.
  //
  // Only `llmFilter` and `visionFilter` currently accept a topic / concurrency
  // at the CLI layer. `strictness` has no analog for the LLM filter; for the
  // vision filter it maps to `--vision-sensitivity`. All other toggles are
  // boolean-only — any per-option config shown in the UI for them is ignored.
  const handleSubmit = useCallback(async () => {
    const options: Record<string, unknown> = {
      input: selectedDataset,
    };

    // camelCase key the executor will convert to the matching CLI flag.
    const TOGGLE_TO_CLI_KEY: Record<CleaningKey, string> = {
      dedupe: 'dedupe',
      trim: 'trim',
      lowercase: 'lowercase',
      llmFilter: 'llmFilter',
      visionFilter: 'visionFilter',
      nsfwCheck: 'checkNsfw',
      imageDedupe: 'dedupeImages',
      mathVerify: 'verifyMath',
      factCheck: 'factCheck',
    };

    for (const key of CLEANING_OPTIONS_KEYS) {
      if (!toggles[key]) continue;
      options[TOGGLE_TO_CLI_KEY[key]] = true;

      const cfg = configs[key];

      if (key === 'llmFilter') {
        if (cfg.targetFields.length > 0) {
          options.target = cfg.targetFields.join(',');
        }
        if (cfg.concurrency !== 4 && cfg.concurrency !== '') {
          options.ollamaConcurrency = cfg.concurrency;
        }
      } else if (key === 'visionFilter') {
        if (cfg.targetFields.length > 0) {
          options.visionTarget = cfg.targetFields.join(',');
        }
        if (cfg.strictness === 'low') options.visionSensitivity = '0.3';
        else if (cfg.strictness === 'high') options.visionSensitivity = '0.7';
        if (cfg.concurrency !== 4 && cfg.concurrency !== '') {
          options.visionConcurrency = cfg.concurrency;
        }
      }
    }

    await submitJob('clean', options);
  }, [submitJob, selectedDataset, toggles, configs]);

  // Cleaning summary from completed job counters
  const cleaningSummary = useMemo(() => {
    if (!completedJob || completedJob.status !== 'completed') return null;
    return completedJob.progress?.counters ?? null;
  }, [completedJob]);

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
            {t('clean.title')}
          </Title>
          <Text c="dimmed" size="sm">
            {commandMeta?.description ?? t('clean.description')}
          </Text>
        </div>

        {/* Dataset selector */}
        <DatasetSelector
          datasets={datasets}
          fetchError={datasetsError}
          value={selectedDataset}
          onChange={setSelectedDataset}
          label={t('clean.selectDataset')}
          required
        />

        {/* Cleaning options with toggles */}
        <Fieldset
          legend={`${t('clean.cleaningOptions')} (${enabledCount} ${t('common.status').toLowerCase()})`}
        >
          <Stack gap="md">
            {CLEANING_OPTIONS_KEYS.map((key) => (
              <div key={key}>
                <Switch
                  label={t(`clean.${key}`)}
                  description={t(`clean.${key}Desc`)}
                  checked={toggles[key]}
                  onChange={(e) => handleToggle(key, e.currentTarget.checked)}
                />

                {/* Expandable config section */}
                <Collapse in={toggles[key]}>
                  <Fieldset legend={t('clean.configSection')} mt="xs" ml="md">
                    <Stack gap="xs">
                      <div>
                        <Text size="xs" fw={500} mb={4}>
                          {t('clean.strictness')}
                        </Text>
                        <SegmentedControl
                          value={configs[key].strictness}
                          onChange={(val) => handleConfigChange(key, 'strictness', val)}
                          data={[
                            { label: t('clean.strictnessLow', 'Low'), value: 'low' },
                            { label: t('clean.strictnessMedium', 'Medium'), value: 'medium' },
                            { label: t('clean.strictnessHigh', 'High'), value: 'high' },
                          ]}
                          size="xs"
                        />
                      </div>
                      <TagsInput
                        label={t('clean.targetFields')}
                        placeholder="e.g. text, content, description"
                        value={configs[key].targetFields}
                        onChange={(val) => handleConfigChange(key, 'targetFields', val)}
                        size="xs"
                      />
                      <NumberInput
                        label={t('clean.concurrency')}
                        value={configs[key].concurrency}
                        onChange={(val) => handleConfigChange(key, 'concurrency', val as number)}
                        min={1}
                        max={32}
                        size="xs"
                      />
                    </Stack>
                  </Fieldset>
                </Collapse>
              </div>
            ))}
          </Stack>
        </Fieldset>

        {/* Error alert */}
        {submitError && (
          <Alert color="red" title={t('common.error')}>
            {submitError}
          </Alert>
        )}

        {/* Progress panel */}
        {jobId && <ProgressPanel jobId={jobId} />}

        {/* Cleaning summary after completion */}
        {cleaningSummary && Object.keys(cleaningSummary).length > 0 && (
          <Fieldset legend={t('clean.summary')}>
            <Group gap="sm">
              {Object.entries(cleaningSummary).map(([key, val]) => (
                <Badge key={key} variant="light" size="lg">
                  {key}: {val}
                </Badge>
              ))}
            </Group>
          </Fieldset>
        )}

        {/* Submit */}
        <Group justify="flex-end">
          <Button onClick={handleSubmit} loading={isSubmitting} disabled={!selectedDataset}>
            {t('common.submit')}
          </Button>
        </Group>
      </Stack>
    </Container>
  );
}
