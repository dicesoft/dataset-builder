import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Container,
  Group,
  NumberInput,
  Select,
  Skeleton,
  Stack,
  Switch,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { useForm } from '@mantine/form';
import { useTranslation } from 'react-i18next';
import { apiGet } from '@/utils/api';
import { useJob } from '@/hooks/useJob';
import { ProgressPanel } from '@/components/ProgressPanel/ProgressPanel';

interface DatasetInfo {
  name: string;
  path: string;
  records: number;
}

const OUTPUT_FORMATS = [
  { value: 'json', label: 'JSON' },
  { value: 'jsonl', label: 'JSONL' },
  { value: 'csv', label: 'CSV' },
];

export default function Export() {
  const { t } = useTranslation();
  const { submitJob, jobId, isSubmitting, error: submitError } = useJob();

  // Dataset list
  const [datasets, setDatasets] = useState<DatasetInfo[]>([]);
  const [datasetsLoading, setDatasetsLoading] = useState(true);

  const form = useForm({
    initialValues: {
      dataset: '',
      format: 'json',
      flatten: false,
      prettyPrint: false,
      outputPath: '',
    },
    validate: {
      dataset: (v) => (v ? null : t('export.datasetRequired')),
      outputPath: (v) => (v ? null : t('export.outputPathRequired')),
    },
  });

  // Fetch datasets
  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const data = await apiGet<{ datasets: DatasetInfo[] }>('/api/v1/datasets');
        if (!cancelled) setDatasets(data.datasets ?? []);
      } catch {
        // Silently handle — user can still type a path
      } finally {
        if (!cancelled) setDatasetsLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const datasetData = datasets.map((d) => ({
    value: d.path,
    label: `${d.name} (${d.records} ${t('common.records')})`,
  }));

  const handleSubmit = useCallback(
    async (values: typeof form.values) => {
      await submitJob('export', {
        input: values.dataset,
        format: values.format,
        flatten: values.flatten,
        prettyPrint: values.prettyPrint,
        output: values.outputPath,
      });
    },
    [submitJob]
  );

  return (
    <Container size="lg" py="md">
      <Stack gap="lg">
        <div>
          <Title order={2} mb={4}>
            {t('export.title')}
          </Title>
          <Text c="dimmed" size="sm">
            {t('export.description')}
          </Text>
        </div>

        {submitError && (
          <Alert color="red" title={t('common.error')}>
            {submitError}
          </Alert>
        )}

        {jobId && <ProgressPanel jobId={jobId} />}

        <form onSubmit={form.onSubmit(handleSubmit)}>
          <Stack gap="md">
            {datasetsLoading ? (
              <Skeleton height={36} />
            ) : (
              <Select
                label={t('export.dataset')}
                placeholder={t('common.noDatasetSelected')}
                data={datasetData}
                searchable
                clearable
                {...form.getInputProps('dataset')}
              />
            )}

            <Select
              label={t('export.format')}
              data={OUTPUT_FORMATS}
              {...form.getInputProps('format')}
            />

            <Switch
              label={t('export.flatten')}
              description={t('export.flattenDescription')}
              {...form.getInputProps('flatten', { type: 'checkbox' })}
            />

            <Switch
              label={t('export.prettyPrint')}
              description={t('export.prettyPrintDescription')}
              {...form.getInputProps('prettyPrint', { type: 'checkbox' })}
            />

            <TextInput
              label={t('export.outputPath')}
              placeholder="./output/export.json"
              {...form.getInputProps('outputPath')}
            />

            <Group justify="flex-end">
              <Button type="button" variant="default" onClick={() => form.reset()}>
                {t('common.reset')}
              </Button>
              <Button type="submit" loading={isSubmitting}>
                {t('common.submit')}
              </Button>
            </Group>
          </Stack>
        </form>
      </Stack>
    </Container>
  );
}
