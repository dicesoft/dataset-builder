import { useEffect, useState, useCallback } from 'react';
import { Badge, Popover, Stack, Text, Group, Indicator } from '@mantine/core';
import { useTranslation } from 'react-i18next';
import { apiGet } from '@/utils/api';

interface Dependency {
  name: string;
  available: boolean;
  version?: string;
  error?: string;
}

interface HealthData {
  status: string;
  uptime: number;
  dependencies: Dependency[];
  activeJobs: number;
  queuedJobs: number;
}

type HealthLevel = 'green' | 'yellow' | 'red';

function getHealthLevel(data: HealthData | null, error: boolean): HealthLevel {
  if (error || !data) return 'red';
  const allAvailable = data.dependencies.every((d) => d.available);
  if (allAvailable) return 'green';
  return 'yellow';
}

function getBadgeColor(level: HealthLevel): string {
  switch (level) {
    case 'green':
      return 'green';
    case 'yellow':
      return 'yellow';
    case 'red':
      return 'red';
  }
}

const POLL_INTERVAL = 30_000;

export function HealthBadge() {
  const { t } = useTranslation();
  const [health, setHealth] = useState<HealthData | null>(null);
  const [hasError, setHasError] = useState(false);
  const [opened, setOpened] = useState(false);

  const fetchHealth = useCallback(async () => {
    try {
      const data = await apiGet<HealthData>('/api/v1/health');
      setHealth(data);
      setHasError(false);
    } catch {
      setHasError(true);
    }
  }, []);

  useEffect(() => {
    fetchHealth();
    const id = setInterval(fetchHealth, POLL_INTERVAL);
    return () => clearInterval(id);
  }, [fetchHealth]);

  const level = getHealthLevel(health, hasError);
  const color = getBadgeColor(level);

  const healthLabelKey =
    level === 'green'
      ? 'health.healthy'
      : level === 'yellow'
        ? 'health.degraded'
        : 'health.offline';

  return (
    <Popover opened={opened} onChange={setOpened} position="bottom-end" withArrow shadow="md">
      <Popover.Target>
        <Indicator
          color={color}
          size={8}
          offset={4}
          processing={level === 'yellow'}
          style={{ cursor: 'pointer' }}
          onClick={() => setOpened((o) => !o)}
        >
          <Badge variant="light" color={color} size="sm">
            {t(healthLabelKey)}
          </Badge>
        </Indicator>
      </Popover.Target>

      <Popover.Dropdown>
        <Stack gap="xs">
          <Text fw={600} size="sm">
            {t('health.title')}
          </Text>

          {hasError && (
            <Text size="xs" c="red">
              {t('health.unreachable')}
            </Text>
          )}

          {health && (
            <>
              {health.dependencies.map((dep) => (
                <Group key={dep.name} justify="space-between" gap="xs">
                  <Text size="xs">{dep.name}</Text>
                  {dep.available ? (
                    <Badge size="xs" color="green" variant="dot">
                      {dep.version ?? t('common.ok')}
                    </Badge>
                  ) : (
                    <Badge size="xs" color="red" variant="dot">
                      {dep.error ?? t('health.unavailable')}
                    </Badge>
                  )}
                </Group>
              ))}

              <Group justify="space-between" gap="xs" mt="xs">
                <Text size="xs" c="dimmed">
                  {t('health.activeJobs', { count: health.activeJobs })}
                </Text>
                <Text size="xs" c="dimmed">
                  {t('health.queuedJobs', { count: health.queuedJobs })}
                </Text>
              </Group>
            </>
          )}
        </Stack>
      </Popover.Dropdown>
    </Popover>
  );
}
