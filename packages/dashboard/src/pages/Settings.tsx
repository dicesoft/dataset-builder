import { useCallback, useEffect, useState } from 'react';
import {
  Accordion,
  Alert,
  Badge,
  Button,
  Container,
  Group,
  Loader,
  NumberInput,
  Paper,
  Skeleton,
  Select,
  Stack,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { useTranslation } from 'react-i18next';
import { apiGet } from '@/utils/api';
import { useConfigStore } from '@/stores/configStore';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface OllamaModel {
  name: string;
  size: number;
}

interface DependencyStatus {
  name: string;
  available: boolean;
  version?: string;
  error?: string;
}

interface HealthData {
  status: string;
  dependencies: DependencyStatus[];
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function Settings() {
  const { t } = useTranslation();
  const { config, loading, error, fetchConfig, updateConfig, resetConfig } = useConfigStore();

  // Models state
  const [models, setModels] = useState<OllamaModel[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);

  // Health state
  const [health, setHealth] = useState<HealthData | null>(null);
  const [healthLoading, setHealthLoading] = useState(false);

  // Local form values (to avoid patching on every keystroke)
  const [localValues, setLocalValues] = useState<Record<string, unknown>>({});
  const [dirty, setDirty] = useState(false);

  // Fetch config and health on mount
  useEffect(() => {
    fetchConfig();
    loadHealth();
  }, [fetchConfig]);

  // Sync config to local values when config changes
  useEffect(() => {
    if (config) {
      setLocalValues(
        typeof config === 'object' && 'settings' in config
          ? ((config as Record<string, unknown>).settings as Record<string, unknown>)
          : config
      );
      setDirty(false);
    }
  }, [config]);

  // Load health data
  const loadHealth = useCallback(async () => {
    setHealthLoading(true);
    try {
      const data = await apiGet<HealthData>('/api/v1/health');
      setHealth(data);
    } catch {
      // Non-fatal
    } finally {
      setHealthLoading(false);
    }
  }, []);

  // Sync Ollama models
  const syncModels = useCallback(async () => {
    setModelsLoading(true);
    try {
      const data = await apiGet<{ models: OllamaModel[]; count: number }>('/api/v1/models');
      setModels(data.models);
    } catch {
      // Non-fatal
    } finally {
      setModelsLoading(false);
    }
  }, []);

  // Update a local value
  const setField = useCallback((key: string, value: unknown) => {
    setLocalValues((prev) => ({ ...prev, [key]: value }));
    setDirty(true);
  }, []);

  // Save changes
  const handleSave = useCallback(async () => {
    if (!dirty) return;
    await updateConfig(localValues);
    setDirty(false);
  }, [updateConfig, localValues, dirty]);

  // Reset to defaults
  const handleReset = useCallback(async () => {
    await resetConfig();
  }, [resetConfig]);

  // Model options for selects
  const modelOptions = models.map((m) => ({ value: m.name, label: m.name }));

  // Helper to get config value
  const val = (key: string): string => {
    const v = localValues[key];
    return v != null ? String(v) : '';
  };

  const numVal = (key: string): number | string => {
    const v = localValues[key];
    if (v === '' || v === null || v === undefined) return '';
    return Number(v);
  };

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  if (loading && !config) {
    return (
      <Container size="lg" py="md">
        <Stack gap="lg">
          <div>
            <Skeleton height={28} width={200} mb={4} />
            <Skeleton height={14} width={300} />
          </div>
          {Array.from({ length: 4 }).map((_, i) => (
            <Paper key={i} withBorder p="md">
              <Skeleton height={20} width={150} mb="sm" />
              <Stack gap="sm">
                <Skeleton height={36} />
                <Skeleton height={36} />
              </Stack>
            </Paper>
          ))}
        </Stack>
      </Container>
    );
  }

  return (
    <Container size="lg" py="md">
      <Stack gap="lg">
        <div>
          <Title order={2} mb={4}>
            {t('settings.title')}
          </Title>
          <Text c="dimmed" size="sm">
            {t('settings.description')}
          </Text>
        </div>

        {/* Error */}
        {error && (
          <Alert color="red" title={t('common.error')}>
            {error}
          </Alert>
        )}

        <Accordion
          variant="contained"
          multiple
          defaultValue={['ollama', 'output', 'concurrency', 'dependencies']}
        >
          {/* Ollama Section */}
          <Accordion.Item value="ollama">
            <Accordion.Control>{t('settings.ollama')}</Accordion.Control>
            <Accordion.Panel>
              <Stack gap="sm">
                <TextInput
                  label={t('settings.ollamaUrl')}
                  value={val('ollamaUrl')}
                  onChange={(e) => setField('ollamaUrl', e.currentTarget.value)}
                  placeholder="http://127.0.0.1:11434"
                />
                {modelOptions.length > 0 ? (
                  <Select
                    label={t('settings.ollamaModel')}
                    data={modelOptions}
                    value={val('ollamaModel') || null}
                    onChange={(v) => setField('ollamaModel', v)}
                    searchable
                    clearable
                  />
                ) : (
                  <TextInput
                    label={t('settings.ollamaModel')}
                    value={val('ollamaModel')}
                    onChange={(e) => setField('ollamaModel', e.currentTarget.value)}
                    placeholder="llama3.2"
                  />
                )}
                {modelOptions.length > 0 ? (
                  <Select
                    label={t('settings.ollamaVisionModel')}
                    data={modelOptions}
                    value={val('ollamaVisionModel') || null}
                    onChange={(v) => setField('ollamaVisionModel', v)}
                    searchable
                    clearable
                  />
                ) : (
                  <TextInput
                    label={t('settings.ollamaVisionModel')}
                    value={val('ollamaVisionModel')}
                    onChange={(e) => setField('ollamaVisionModel', e.currentTarget.value)}
                    placeholder="llava"
                  />
                )}
                <Button variant="light" onClick={syncModels} loading={modelsLoading} size="sm">
                  {t('settings.syncModels')}
                </Button>
              </Stack>
            </Accordion.Panel>
          </Accordion.Item>

          {/* Output Section */}
          <Accordion.Item value="output">
            <Accordion.Control>{t('settings.output')}</Accordion.Control>
            <Accordion.Panel>
              <Stack gap="sm">
                <TextInput
                  label={t('settings.outputDir')}
                  value={val('outputDir')}
                  onChange={(e) => setField('outputDir', e.currentTarget.value)}
                  placeholder="./output"
                />
                <Select
                  label={t('settings.outputFormat')}
                  data={[
                    { value: 'json', label: 'JSON' },
                    { value: 'jsonl', label: 'JSONL' },
                    { value: 'csv', label: 'CSV' },
                    { value: 'parquet', label: 'Parquet' },
                  ]}
                  value={val('outputFormat') || null}
                  onChange={(v) => setField('outputFormat', v)}
                  clearable
                />
              </Stack>
            </Accordion.Panel>
          </Accordion.Item>

          {/* Concurrency Section */}
          <Accordion.Item value="concurrency">
            <Accordion.Control>{t('settings.concurrency')}</Accordion.Control>
            <Accordion.Panel>
              <Stack gap="sm">
                <NumberInput
                  label={t('settings.maxConcurrent')}
                  value={numVal('maxConcurrent')}
                  onChange={(v) => setField('maxConcurrent', v)}
                  min={1}
                  max={32}
                  allowDecimal={false}
                />
                <NumberInput
                  label={t('settings.batchSize')}
                  value={numVal('batchSize')}
                  onChange={(v) => setField('batchSize', v)}
                  min={1}
                  max={1000}
                  allowDecimal={false}
                />
              </Stack>
            </Accordion.Panel>
          </Accordion.Item>

          {/* Dependencies Section */}
          <Accordion.Item value="dependencies">
            <Accordion.Control>{t('settings.dependencies')}</Accordion.Control>
            <Accordion.Panel>
              {healthLoading ? (
                <Group>
                  <Loader size="xs" />
                  <Text size="sm">{t('common.loading')}</Text>
                </Group>
              ) : health?.dependencies ? (
                <Stack gap="xs">
                  {health.dependencies.map((dep) => (
                    <Paper key={dep.name} p="xs" withBorder>
                      <Group justify="space-between">
                        <Group gap="xs">
                          <Text size="sm" fw={500}>
                            {dep.name}
                          </Text>
                          {dep.version && (
                            <Text size="xs" c="dimmed">
                              v{dep.version}
                            </Text>
                          )}
                        </Group>
                        <Badge color={dep.available ? 'green' : 'red'} variant="light" size="sm">
                          {dep.available ? t('health.available') : t('health.unavailable')}
                        </Badge>
                      </Group>
                      {dep.error && (
                        <Text size="xs" c="red" mt={4}>
                          {dep.error}
                        </Text>
                      )}
                    </Paper>
                  ))}
                </Stack>
              ) : (
                <Text size="sm" c="dimmed">
                  {t('health.unreachable')}
                </Text>
              )}
            </Accordion.Panel>
          </Accordion.Item>
        </Accordion>

        {/* Action buttons */}
        <Group justify="flex-end">
          <Button variant="default" onClick={handleReset}>
            {t('settings.resetDefaults')}
          </Button>
          <Button onClick={handleSave} loading={loading} disabled={!dirty}>
            {t('common.save')}
          </Button>
        </Group>
      </Stack>
    </Container>
  );
}
