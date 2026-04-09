import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Button, Container, Select, Skeleton, Stack, Text, Title } from '@mantine/core';
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
import { useConfigStore } from '@/stores/configStore';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Preset {
  name: string;
  description: string;
  options: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Field groups — type-specific visibility handled via filtering
// ---------------------------------------------------------------------------

const LLM_FIELDS = new Set(['prompt', 'schema', 'model']);
const FAKER_FIELDS = new Set(['locale']);
const COMMON_FIELDS = new Set(['type', 'count', 'output', 'format']);

function useGroupsForType(generatorType: string | null): FieldGroup[] {
  const { t } = useTranslation();
  return useMemo(() => {
    const groups: FieldGroup[] = [
      { label: t('generate.typeGroup'), fields: ['type', 'count', 'output', 'format'] },
    ];
    if (generatorType === 'llm') {
      groups.push({ label: t('generate.llmGroup'), fields: ['prompt', 'schema', 'model'] });
    }
    if (generatorType === 'faker') {
      groups.push({ label: t('generate.fakerGroup'), fields: ['locale'] });
    }
    return groups;
  }, [t, generatorType]);
}

function filterOptions(options: CommandOption[], generatorType: string | null): CommandOption[] {
  return options.filter((opt) => {
    if (COMMON_FIELDS.has(opt.name)) return true;
    if (generatorType === 'llm' && LLM_FIELDS.has(opt.name)) return true;
    if (generatorType === 'faker' && FAKER_FIELDS.has(opt.name)) return true;
    // Hide type-specific fields when no type or different type selected
    if (LLM_FIELDS.has(opt.name) || FAKER_FIELDS.has(opt.name)) return false;
    return true;
  });
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function Generate() {
  const { t } = useTranslation();

  // Default model from config
  const ollamaModel = useConfigStore((s) => (s.config?.ollamaModel as string) ?? '');

  // Command schema from centralized metadataStore
  const commandMeta = useMetadataStore((s) => s.commandMetas.get('generate') ?? null);
  const schemaLoading = useMetadataStore((s) => s.loading);
  const schemaError = useMetadataStore((s) =>
    !s.loading && !s.commandMetas.has('generate') && !s.error
      ? 'Generate command not found in server metadata'
      : s.error
  );

  // Generator type for conditional fields
  const [generatorType, setGeneratorType] = useState<string | null>(null);

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
          '/api/v1/commands/generate/presets'
        );
        if (!cancelled) setPresets(data.presets);
      } catch {
        // Presets are optional
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

  const presetData = useMemo(
    () =>
      presets.map((p) => ({
        value: p.name,
        label: `${p.name} — ${p.description}`,
      })),
    [presets]
  );

  // Filtered options and groups based on selected type
  const visibleOptions = useMemo(
    () => (commandMeta ? filterOptions(commandMeta.options, generatorType) : []),
    [commandMeta, generatorType]
  );

  const groups = useGroupsForType(generatorType);

  // Submit handler
  const handleSubmit = useCallback(
    async (values: Record<string, unknown>) => {
      await submitJob('generate', values);
    },
    [submitJob]
  );

  // Track type changes from FormBuilder via wrapper
  const handleFormSubmit = useCallback(
    async (values: Record<string, unknown>) => {
      await handleSubmit(values);
    },
    [handleSubmit]
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
            {t('generate.title')}
          </Title>
          <Text c="dimmed" size="sm">
            {commandMeta?.description ?? t('generate.description')}
          </Text>
        </div>

        {/* Type selector to control field visibility */}
        <Select
          label={t('generate.typeGroup')}
          description={t('generate.chooseType')}
          data={[
            { value: 'faker', label: 'Faker (synthetic data)' },
            { value: 'llm', label: 'LLM (AI-generated)' },
          ]}
          value={generatorType}
          onChange={setGeneratorType}
          clearable
          placeholder={t('generate.selectType')}
        />

        {/* Preset selector */}
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
          <Alert color="red" title={t('common.error')}>
            {submitError}
          </Alert>
        )}

        {/* Progress panel */}
        {jobId && <ProgressPanel jobId={jobId} />}

        {/* View Results link on completion */}
        {jobId && (
          <Button component="a" href="/data" variant="light">
            {t('common.viewResults')}
          </Button>
        )}

        {/* Form */}
        {commandMeta && (
          <FormBuilder
            key={`${selectedPreset ?? '__default'}-${generatorType ?? 'none'}`}
            commandName="generate"
            options={visibleOptions}
            groups={groups}
            onSubmit={handleFormSubmit}
            loading={isSubmitting}
            initialValues={{
              ...(ollamaModel ? { model: ollamaModel } : {}),
              ...presetValues,
              ...(generatorType ? { type: generatorType } : {}),
            }}
          />
        )}
      </Stack>
    </Container>
  );
}
