import { useCallback, useState } from 'react';
import {
  Alert,
  Button,
  Container,
  Group,
  NumberInput,
  Stack,
  Switch,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { useForm } from '@mantine/form';
import { useTranslation } from 'react-i18next';
import { useJob } from '@/hooks/useJob';
import { ProgressPanel } from '@/components/ProgressPanel/ProgressPanel';

export default function Prune() {
  const { t } = useTranslation();
  const { submitJob, jobId, isSubmitting, error: submitError } = useJob();
  const [dryRunCompleted, setDryRunCompleted] = useState(false);

  const form = useForm({
    initialValues: {
      pattern: '',
      daysOld: 30,
      recursive: true,
      dryRun: true,
    },
    validate: {
      pattern: (v) => (v.trim() ? null : t('prune.patternRequired')),
      daysOld: (v) => (typeof v === 'number' && v >= 0 ? null : t('prune.daysOldInvalid')),
    },
  });

  const handleDryRun = useCallback(async () => {
    const validation = form.validate();
    if (validation.hasErrors) return;

    await submitJob('prune', {
      pattern: form.values.pattern,
      daysOld: form.values.daysOld,
      recursive: form.values.recursive,
      dryRun: true,
    });
    setDryRunCompleted(true);
  }, [submitJob, form]);

  const handleConfirmDelete = useCallback(async () => {
    const validation = form.validate();
    if (validation.hasErrors) return;

    await submitJob('prune', {
      pattern: form.values.pattern,
      daysOld: form.values.daysOld,
      recursive: form.values.recursive,
      dryRun: false,
    });
    setDryRunCompleted(false);
  }, [submitJob, form]);

  return (
    <Container size="lg" py="md">
      <Stack gap="lg">
        <div>
          <Title order={2} mb={4}>
            {t('prune.title')}
          </Title>
          <Text c="dimmed" size="sm">
            {t('prune.description')}
          </Text>
        </div>

        {submitError && (
          <Alert color="red" title={t('common.error')}>
            {submitError}
          </Alert>
        )}

        {jobId && <ProgressPanel jobId={jobId} />}

        <form onSubmit={(e) => e.preventDefault()}>
          <Stack gap="md">
            <TextInput
              label={t('prune.pattern')}
              placeholder="*.tmp"
              description={t('prune.patternDescription')}
              required
              {...form.getInputProps('pattern')}
            />

            <NumberInput
              label={t('prune.daysOld')}
              description={t('prune.daysOldDescription')}
              min={0}
              {...form.getInputProps('daysOld')}
            />

            <Switch
              label={t('prune.recursive')}
              description={t('prune.recursiveDescription')}
              {...form.getInputProps('recursive', { type: 'checkbox' })}
            />

            <Switch
              label={t('prune.dryRun')}
              description={t('prune.dryRunDescription')}
              {...form.getInputProps('dryRun', { type: 'checkbox' })}
            />

            <Group justify="flex-end">
              <Button type="button" variant="default" onClick={() => form.reset()}>
                {t('common.reset')}
              </Button>
              <Button
                variant="light"
                loading={isSubmitting && form.values.dryRun}
                onClick={handleDryRun}
              >
                {t('prune.dryRunButton')}
              </Button>
              <Button
                color="red"
                loading={isSubmitting && !form.values.dryRun}
                onClick={handleConfirmDelete}
                disabled={!dryRunCompleted}
              >
                {t('prune.confirmDelete')}
              </Button>
            </Group>
          </Stack>
        </form>
      </Stack>
    </Container>
  );
}
