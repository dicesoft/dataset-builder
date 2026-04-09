import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Container, Select, Skeleton, Stack, Text, Title } from '@mantine/core';
import { useTranslation } from 'react-i18next';
import { apiGet } from '@/utils/api';
import { useJob } from '@/hooks/useJob';
import {
  FormBuilder,
  type CommandOption,
  type FieldGroup,
} from '@/components/FormBuilder/FormBuilder';
import { ProgressPanel } from '@/components/ProgressPanel/ProgressPanel';
import { useMetadataStore } from '@/stores/metadataStore';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Preset {
  name: string;
  description: string;
  options: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Download-related fields hidden until download toggle is enabled
// ---------------------------------------------------------------------------

const DOWNLOAD_DETAIL_FIELDS = new Set([
  'formats',
  'concurrency',
  'limit',
  'maxConcurrent',
  'depth',
]);

// ---------------------------------------------------------------------------
// Field grouping for the scrape command
// ---------------------------------------------------------------------------

function useScrapeGroups(downloadEnabled: boolean): FieldGroup[] {
  const { t } = useTranslation();
  return useMemo(
    () => [
      {
        label: t('scrape.searchGroup'),
        fields: ['search', 'searchProvider', 'searchCount'],
      },
      {
        label: t('scrape.downloadGroup'),
        fields: downloadEnabled
          ? ['download', 'formats', 'concurrency', 'limit', 'maxConcurrent', 'depth']
          : ['download'],
      },
      {
        label: t('scrape.youtubeGroup'),
        fields: ['ytUrl', 'ytCount', 'ytQuality', 'ytAudioOnly', 'ytVideoOnly'],
      },
    ],
    [t, downloadEnabled]
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function Scrape() {
  const { t } = useTranslation();

  // Track download toggle for progressive disclosure
  const [downloadEnabled, setDownloadEnabled] = useState(false);
  const scrapeGroups = useScrapeGroups(downloadEnabled);

  // Command schema from centralized metadataStore
  const commandMeta = useMetadataStore((s) => s.commandMetas.get('scrape') ?? null);
  const schemaLoading = useMetadataStore((s) => s.loading);
  const schemaError = useMetadataStore((s) =>
    !s.loading && !s.commandMetas.has('scrape') && !s.error
      ? 'Scrape command not found in server metadata'
      : s.error
  );

  // Presets
  const [presets, setPresets] = useState<Preset[]>([]);
  const [selectedPreset, setSelectedPreset] = useState<string | null>(null);
  const [presetValues, setPresetValues] = useState<Record<string, unknown>>({});

  // Job state
  const { submitJob, jobId, isSubmitting, error: submitError } = useJob();

  // Fetch presets
  useEffect(() => {
    let cancelled = false;

    async function loadPresets() {
      try {
        const data = await apiGet<{ command: string; presets: Preset[] }>(
          '/api/v1/commands/scrape/presets'
        );
        if (!cancelled) setPresets(data.presets);
      } catch {
        // Presets are optional — silently ignore
      }
    }

    loadPresets();
    return () => {
      cancelled = true;
    };
  }, []);

  // Handle preset selection
  const handlePresetChange = useCallback(
    (value: string | null) => {
      setSelectedPreset(value);
      if (!value) {
        setPresetValues({});
        return;
      }
      const preset = presets.find((p) => p.name === value);
      if (preset) {
        setPresetValues(preset.options);
      }
    },
    [presets]
  );

  // Preset select data
  const presetData = useMemo(
    () =>
      presets.map((p) => ({
        value: p.name,
        label: `${p.name} — ${p.description}`,
      })),
    [presets]
  );

  // Submit handler
  const handleSubmit = useCallback(
    async (values: Record<string, unknown>) => {
      await submitJob('scrape', values);
    },
    [submitJob]
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
            {t('scrape.title')}
          </Title>
          <Text c="dimmed" size="sm">
            {commandMeta?.description ?? t('scrape.description')}
          </Text>
        </div>

        {/* Preset selector (T045) */}
        {presets.length > 0 && (
          <Select
            label={t('scrape.preset')}
            placeholder={t('scrape.noPreset')}
            data={presetData}
            value={selectedPreset}
            onChange={handlePresetChange}
            clearable
          />
        )}

        {/* Error alert */}
        {submitError && (
          <Alert color="red" title={t('scrape.submissionError')}>
            {submitError}
          </Alert>
        )}

        {/* Show progress panel when a job has been submitted */}
        {jobId && <ProgressPanel jobId={jobId} />}

        {/* Form */}
        {commandMeta && (
          <FormBuilder
            key={selectedPreset ?? '__default'}
            commandName="scrape"
            options={
              downloadEnabled
                ? commandMeta.options
                : commandMeta.options.filter((o) => !DOWNLOAD_DETAIL_FIELDS.has(o.name))
            }
            groups={scrapeGroups}
            onSubmit={handleSubmit}
            loading={isSubmitting}
            initialValues={presetValues}
            onValuesChange={(values) => {
              setDownloadEnabled(!!values.download);
            }}
          />
        )}
      </Stack>
    </Container>
  );
}
