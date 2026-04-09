import { useCallback, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Container,
  Fieldset,
  Group,
  Loader,
  Paper,
  Select,
  Slider,
  Stack,
  Switch,
  Table,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { useTranslation } from 'react-i18next';
import { useJob } from '@/hooks/useJob';
import { useJobStore, type JobRecord } from '@/stores/jobStore';
import { ProgressPanel } from '@/components/ProgressPanel/ProgressPanel';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CODECS = [
  { value: 'h264', label: 'H.264' },
  { value: 'h265', label: 'H.265 / HEVC' },
  { value: 'av1', label: 'AV1' },
];

const FORMATS = [
  { value: 'mp4', label: 'MP4' },
  { value: 'webm', label: 'WebM' },
  { value: 'mkv', label: 'MKV' },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function Compress() {
  const { t } = useTranslation();
  const { submitJob, jobId, isSubmitting, error: submitError } = useJob();
  const job = useJobStore((s) => (jobId ? s.jobs.get(jobId) : undefined)) as JobRecord | undefined;

  // Form state
  const [directory, setDirectory] = useState('');
  const [codec, setCodec] = useState<string | null>('h264');
  const [videoQuality, setVideoQuality] = useState(23);
  const [format, setFormat] = useState<string | null>('mp4');
  const [imageQuality, setImageQuality] = useState(80);
  const [dryRun, setDryRun] = useState(false);

  // Submit handler
  const handleSubmit = useCallback(async () => {
    if (!directory.trim()) return;

    await submitJob('compress', {
      directory: directory.trim(),
      ...(codec ? { codec } : {}),
      videoQuality,
      ...(format ? { format } : {}),
      imageQuality,
      dryRun,
    });
  }, [submitJob, directory, codec, videoQuality, format, imageQuality, dryRun]);

  // Reset handler
  const handleReset = useCallback(() => {
    setDirectory('');
    setCodec('h264');
    setVideoQuality(23);
    setFormat('mp4');
    setImageQuality(80);
    setDryRun(false);
  }, []);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <Container size="lg" py="md">
      <Stack gap="lg">
        <div>
          <Title order={2} mb={4}>
            {t('compress.title')}
          </Title>
          <Text c="dimmed" size="sm">
            {t('compress.description')}
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

        {/* Dry-run results table */}
        {dryRun && job?.status === 'completed' && job.progress?.counters && (
          <Paper p="md" withBorder>
            <Stack gap="sm">
              <Text size="sm" fw={600}>
                {t('compress.dryRunResults', 'Dry Run Results')}
              </Text>
              <Table striped highlightOnHover withTableBorder>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>{t('common.metric', 'Metric')}</Table.Th>
                    <Table.Th>{t('common.value', 'Value')}</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {Object.entries(job.progress.counters).map(([key, val]) => {
                    const isSize =
                      key.toLowerCase().includes('size') || key.toLowerCase().includes('bytes');
                    const displayVal = isSize
                      ? `${((val as number) / (1024 * 1024)).toFixed(2)} MB`
                      : key.toLowerCase().includes('saving') ||
                          key.toLowerCase().includes('percent')
                        ? `${val}%`
                        : String(val);
                    return (
                      <Table.Tr key={key}>
                        <Table.Td>
                          <Text size="sm" tt="capitalize">
                            {key.replace(/([A-Z])/g, ' $1').replace(/_/g, ' ')}
                          </Text>
                        </Table.Td>
                        <Table.Td>
                          <Badge
                            variant="light"
                            size="sm"
                            color={key.toLowerCase().includes('saving') ? 'green' : 'gray'}
                          >
                            {displayVal}
                          </Badge>
                        </Table.Td>
                      </Table.Tr>
                    );
                  })}
                </Table.Tbody>
              </Table>
              {job.progress.total > 0 && (
                <Text size="xs" c="dimmed">
                  {t('compress.filesScanned', 'Files scanned')}: {job.progress.total}
                </Text>
              )}
            </Stack>
          </Paper>
        )}

        {/* Input */}
        <TextInput
          label={t('compress.directory')}
          placeholder={t('compress.directoryPlaceholder')}
          value={directory}
          onChange={(e) => setDirectory(e.currentTarget.value)}
          required
        />

        {/* Video settings */}
        <Fieldset legend={t('compress.videoGroup')}>
          <Stack gap="md">
            <Select
              label={t('compress.codec')}
              data={CODECS}
              value={codec}
              onChange={setCodec}
              clearable
            />

            <div>
              <Text size="sm" fw={500} mb="xs">
                {t('compress.videoQuality')} ({videoQuality})
              </Text>
              <Slider
                value={videoQuality}
                onChange={setVideoQuality}
                min={0}
                max={51}
                step={1}
                marks={[
                  { value: 0, label: 'Best' },
                  { value: 23, label: '23' },
                  { value: 51, label: 'Worst' },
                ]}
              />
            </div>

            <Select
              label={t('compress.videoFormat')}
              data={FORMATS}
              value={format}
              onChange={setFormat}
              clearable
            />
          </Stack>
        </Fieldset>

        {/* Image settings */}
        <Fieldset legend={t('compress.imageGroup')}>
          <Stack gap="md">
            <div>
              <Text size="sm" fw={500} mb="xs">
                {t('compress.imageQuality')} ({imageQuality}%)
              </Text>
              <Slider
                value={imageQuality}
                onChange={setImageQuality}
                min={1}
                max={100}
                step={1}
                marks={[
                  { value: 1, label: '1%' },
                  { value: 50, label: '50%' },
                  { value: 100, label: '100%' },
                ]}
              />
            </div>
          </Stack>
        </Fieldset>

        {/* Dry run toggle */}
        <Switch
          label={t('compress.dryRun')}
          description={t('compress.dryRunDesc')}
          checked={dryRun}
          onChange={(e) => setDryRun(e.currentTarget.checked)}
        />

        {/* Action buttons */}
        <Group justify="flex-end">
          <Button variant="default" onClick={handleReset}>
            {t('common.reset')}
          </Button>
          <Button onClick={handleSubmit} loading={isSubmitting} disabled={!directory.trim()}>
            {t('common.submit')}
          </Button>
        </Group>
      </Stack>
    </Container>
  );
}
