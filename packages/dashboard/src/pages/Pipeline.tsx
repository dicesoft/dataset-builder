import { useCallback, useRef, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Card,
  Container,
  Group,
  Paper,
  Stack,
  Text,
  Title,
  Box,
} from '@mantine/core';
import { Dropzone } from '@mantine/dropzone';
import { useTranslation } from 'react-i18next';
import { useJob } from '@/hooks/useJob';
import { useJobStore, type JobRecord } from '@/stores/jobStore';
import { ProgressPanel } from '@/components/ProgressPanel/ProgressPanel';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PipelineStage {
  name: string;
  command: string;
  options?: Record<string, unknown>;
}

interface PipelineConfig {
  name?: string;
  stages: PipelineStage[];
}

type StageStatus = 'pending' | 'active' | 'complete' | 'failed';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseConfig(text: string, filename: string): PipelineConfig {
  // Try JSON first
  if (filename.endsWith('.json')) {
    return JSON.parse(text) as PipelineConfig;
  }

  // Simple YAML parser for pipeline configs
  // Expects: name, stages array with name/command/options
  // For full YAML, a library would be needed; this handles common cases
  try {
    return JSON.parse(text) as PipelineConfig;
  } catch {
    // Basic YAML-like parsing for stage definitions
    const stages: PipelineStage[] = [];
    const lines = text.split('\n');
    let currentStage: Partial<PipelineStage> | null = null;

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('- name:')) {
        if (currentStage?.name && currentStage?.command) {
          stages.push(currentStage as PipelineStage);
        }
        currentStage = { name: trimmed.replace('- name:', '').trim() };
      } else if (trimmed.startsWith('command:') && currentStage) {
        currentStage.command = trimmed.replace('command:', '').trim();
      }
    }
    if (currentStage?.name && currentStage?.command) {
      stages.push(currentStage as PipelineStage);
    }

    if (stages.length === 0) {
      throw new Error('No valid pipeline stages found');
    }

    return { stages };
  }
}

function getStageStatus(stageIndex: number, job: JobRecord | undefined): StageStatus {
  if (!job || !job.progress) return 'pending';

  const phase = job.progress.phase ?? '';
  const counters = job.progress.counters ?? {};
  const currentStage = counters.currentStage as number | undefined;

  if (job.status === 'failed') {
    if (currentStage !== undefined && currentStage === stageIndex) return 'failed';
    if (currentStage !== undefined && stageIndex < currentStage) return 'complete';
    return 'pending';
  }

  if (currentStage !== undefined) {
    if (stageIndex < currentStage) return 'complete';
    if (stageIndex === currentStage) return 'active';
    return 'pending';
  }

  // Fallback: use phase string matching
  if (job.status === 'completed') return 'complete';
  if (job.status === 'running' && stageIndex === 0) return 'active';
  return 'pending';
}

const STATUS_COLORS: Record<StageStatus, string> = {
  pending: 'gray',
  active: 'blue',
  complete: 'green',
  failed: 'red',
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function Pipeline() {
  const { t } = useTranslation();
  const { submitJob, jobId, isSubmitting, error: submitError } = useJob();
  const job = useJobStore((s) => (jobId ? s.jobs.get(jobId) : undefined)) as JobRecord | undefined;

  // Pipeline config state
  const [config, setConfig] = useState<PipelineConfig | null>(null);
  const [configFileName, setConfigFileName] = useState<string>('');
  const [parseError, setParseError] = useState<string | null>(null);
  const [validated, setValidated] = useState(false);
  const [uploadedFilePath, setUploadedFilePath] = useState<string | null>(null);

  // Handle file drop
  const handleDrop = useCallback(async (files: File[]) => {
    if (files.length === 0) return;

    const file = files[0];
    setConfigFileName(file.name);
    setParseError(null);
    setValidated(false);
    setConfig(null);
    setUploadedFilePath(null);

    try {
      // Upload the file
      const formData = new FormData();
      formData.append('file', file);

      const uploadRes = await fetch('/api/v1/upload', {
        method: 'POST',
        body: formData,
      });
      const uploadEnvelope = await uploadRes.json();
      if (!uploadEnvelope.success) {
        throw new Error(uploadEnvelope.error?.message ?? 'Upload failed');
      }
      setUploadedFilePath(uploadEnvelope.data.filePath);

      // Parse for preview
      const text = await file.text();
      const parsed = parseConfig(text, file.name);
      setConfig(parsed);
    } catch (err) {
      setParseError(err instanceof Error ? err.message : 'Failed to parse pipeline config');
    }
  }, []);

  // Validate
  const handleValidate = useCallback(() => {
    if (!config) return;

    // Basic validation
    for (const stage of config.stages) {
      if (!stage.name || !stage.command) {
        setParseError('Each stage must have a name and command');
        setValidated(false);
        return;
      }
    }

    setParseError(null);
    setValidated(true);
  }, [config]);

  // Run pipeline
  const handleRun = useCallback(async () => {
    if (!uploadedFilePath) return;

    await submitJob('run', {
      configFile: uploadedFilePath,
    });
  }, [submitJob, uploadedFilePath]);

  // (activeStep removed — flow diagram doesn't need it)

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <Container size="lg" py="md">
      <Stack gap="lg">
        <div>
          <Title order={2} mb={4}>
            {t('pipeline.title')}
          </Title>
          <Text c="dimmed" size="sm">
            {t('pipeline.description')}
          </Text>
        </div>

        {/* Error alerts */}
        {(parseError || submitError) && (
          <Alert color="red" title={t('common.error')}>
            {parseError ?? submitError}
          </Alert>
        )}

        {/* Validation success */}
        {validated && !parseError && (
          <Alert color="green" title={t('pipeline.validationSuccess')}>
            {config?.stages.length} stages validated
          </Alert>
        )}

        {/* Progress panel */}
        {jobId && <ProgressPanel jobId={jobId} />}

        {/* File upload zone */}
        {!config && (
          <Dropzone
            onDrop={handleDrop}
            accept={['application/json', 'application/x-yaml', 'text/yaml', 'text/plain']}
            maxFiles={1}
          >
            <Stack align="center" gap="sm" py="xl">
              <Text size="lg" fw={500}>
                {t('pipeline.uploadConfig')}
              </Text>
              <Text size="sm" c="dimmed">
                {t('pipeline.uploadHint')}
              </Text>
            </Stack>
          </Dropzone>
        )}

        {/* Pipeline stages flow diagram */}
        {config && config.stages.length > 0 && (
          <Stack gap="md">
            <Text size="sm" fw={500}>
              {t('pipeline.stages')} ({config.stages.length})
            </Text>

            <Stack gap={0} align="center">
              {config.stages.map((stage, idx) => {
                const status = getStageStatus(idx, job);
                const borderColor =
                  status === 'active'
                    ? 'var(--mantine-color-blue-6)'
                    : status === 'complete'
                      ? 'var(--mantine-color-green-6)'
                      : status === 'failed'
                        ? 'var(--mantine-color-red-6)'
                        : 'var(--mantine-color-gray-4)';
                const isActive = status === 'active';

                return (
                  <div key={idx} style={{ width: '100%', maxWidth: 480 }}>
                    {/* Stage card */}
                    <Card
                      withBorder
                      p="sm"
                      style={{
                        borderColor,
                        borderWidth: isActive ? 2 : 1,
                        boxShadow: isActive ? `0 0 8px ${borderColor}` : undefined,
                        transition: 'border-color 0.3s, box-shadow 0.3s',
                      }}
                    >
                      <Group justify="space-between" wrap="nowrap">
                        <Group gap="xs" wrap="nowrap">
                          <Box
                            style={{
                              width: 28,
                              height: 28,
                              borderRadius: '50%',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              fontSize: 12,
                              fontWeight: 700,
                              color: '#fff',
                              backgroundColor: borderColor,
                              flexShrink: 0,
                            }}
                          >
                            {status === 'complete' ? '\u2713' : status === 'failed' ? '!' : idx + 1}
                          </Box>
                          <Stack gap={2}>
                            <Text size="sm" fw={600}>
                              {stage.name}
                            </Text>
                            <Text size="xs" c="dimmed">
                              {stage.command}
                            </Text>
                          </Stack>
                        </Group>
                        <Badge color={STATUS_COLORS[status]} variant="light" size="sm">
                          {t(`pipeline.${status}`)}
                        </Badge>
                      </Group>
                    </Card>

                    {/* Arrow connector between stages */}
                    {idx < config.stages.length - 1 && (
                      <Box
                        style={{
                          display: 'flex',
                          justifyContent: 'center',
                          height: 28,
                          position: 'relative',
                        }}
                      >
                        <svg width="2" height="28" style={{ overflow: 'visible' }}>
                          <line
                            x1="1"
                            y1="0"
                            x2="1"
                            y2="20"
                            stroke={
                              getStageStatus(idx, job) === 'complete'
                                ? 'var(--mantine-color-green-6)'
                                : 'var(--mantine-color-gray-4)'
                            }
                            strokeWidth="2"
                          />
                          <polygon
                            points="-4,20 1,28 6,20"
                            fill={
                              getStageStatus(idx, job) === 'complete'
                                ? 'var(--mantine-color-green-6)'
                                : 'var(--mantine-color-gray-4)'
                            }
                          />
                        </svg>
                      </Box>
                    )}
                  </div>
                );
              })}
            </Stack>
          </Stack>
        )}

        {/* Action buttons */}
        {config && (
          <Group justify="flex-end">
            <Button
              variant="default"
              onClick={() => {
                setConfig(null);
                setConfigFileName('');
                setParseError(null);
                setValidated(false);
                setUploadedFilePath(null);
              }}
            >
              {t('common.reset')}
            </Button>
            <Button variant="light" onClick={handleValidate} disabled={!config}>
              {t('pipeline.validate')}
            </Button>
            <Button onClick={handleRun} loading={isSubmitting} disabled={!uploadedFilePath}>
              {t('pipeline.run')}
            </Button>
          </Group>
        )}
      </Stack>
    </Container>
  );
}
