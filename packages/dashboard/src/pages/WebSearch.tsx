import { useCallback, useState } from 'react';
import {
  Alert,
  Button,
  Container,
  Group,
  NumberInput,
  Paper,
  Select,
  Stack,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { useForm } from '@mantine/form';
import { useTranslation } from 'react-i18next';
import { useJob } from '@/hooks/useJob';
import { ProgressPanel } from '@/components/ProgressPanel/ProgressPanel';

const OUTPUT_FORMATS = [
  { value: 'json', label: 'JSON' },
  { value: 'jsonl', label: 'JSONL' },
  { value: 'csv', label: 'CSV' },
];

export default function WebSearch() {
  const { t } = useTranslation();
  const { submitJob, jobId, isSubmitting, error: submitError } = useJob();

  const form = useForm({
    initialValues: {
      query: '',
      maxResults: 10,
      format: 'json',
    },
    validate: {
      query: (v) => (v.trim() ? null : t('webSearch.queryRequired')),
      maxResults: (v) => (typeof v === 'number' && v > 0 ? null : t('webSearch.maxResultsInvalid')),
    },
  });

  const handleSubmit = useCallback(
    async (values: typeof form.values) => {
      await submitJob('web-search', {
        query: values.query,
        maxResults: values.maxResults,
        format: values.format,
      });
    },
    [submitJob]
  );

  return (
    <Container size="lg" py="md">
      <Stack gap="lg">
        <div>
          <Title order={2} mb={4}>
            {t('webSearch.title')}
          </Title>
          <Text c="dimmed" size="sm">
            {t('webSearch.description')}
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
            <TextInput
              label={t('webSearch.query')}
              placeholder={t('webSearch.queryPlaceholder')}
              required
              {...form.getInputProps('query')}
            />

            <NumberInput
              label={t('webSearch.maxResults')}
              description={t('webSearch.maxResultsDescription')}
              min={1}
              max={100}
              {...form.getInputProps('maxResults')}
            />

            <Select
              label={t('webSearch.format')}
              data={OUTPUT_FORMATS}
              {...form.getInputProps('format')}
            />

            <Group justify="flex-end">
              <Button type="button" variant="default" onClick={() => form.reset()}>
                {t('common.reset')}
              </Button>
              <Button type="submit" loading={isSubmitting}>
                {t('common.search')}
              </Button>
            </Group>
          </Stack>
        </form>
      </Stack>
    </Container>
  );
}
