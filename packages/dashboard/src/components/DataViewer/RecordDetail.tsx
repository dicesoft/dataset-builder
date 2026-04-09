/**
 * T052: RecordDetail component
 * Side drawer showing all fields of a single record.
 * Nested objects as collapsible JSON tree, media fields as inline players.
 */

import { useState } from 'react';
import {
  Drawer,
  Stack,
  Text,
  Group,
  Code,
  Image,
  Collapse,
  UnstyledButton,
  Box,
} from '@mantine/core';
import { useTranslation } from 'react-i18next';

interface RecordDetailProps {
  record: Record<string, unknown> | null;
  onClose: () => void;
}

function getMediaUrl(value: string): string {
  if (value.startsWith('http://') || value.startsWith('https://')) return value;
  return `/api/v1/media/${encodeURIComponent(value)}`;
}

function isImagePath(value: string): boolean {
  const lower = value.toLowerCase();
  return /\.(jpg|jpeg|png|gif|webp|svg)(\?|$)/.test(lower);
}

function isAudioPath(value: string): boolean {
  const lower = value.toLowerCase();
  return /\.(mp3|wav|ogg|flac)(\?|$)/.test(lower);
}

function isVideoPath(value: string): boolean {
  const lower = value.toLowerCase();
  return /\.(mp4|webm|mkv|avi)(\?|$)/.test(lower);
}

/**
 * Recursive JSON tree renderer for nested objects.
 */
function JsonTree({ data, depth = 0 }: { data: unknown; depth?: number }) {
  const [expanded, setExpanded] = useState(depth < 2);

  if (data === null || data === undefined) {
    return (
      <Text size="xs" c="dimmed" span>
        null
      </Text>
    );
  }

  if (typeof data !== 'object') {
    return (
      <Text size="xs" span>
        {String(data)}
      </Text>
    );
  }

  const entries = Array.isArray(data)
    ? data.map((v, i) => [String(i), v] as [string, unknown])
    : Object.entries(data as Record<string, unknown>);

  const label = Array.isArray(data) ? `Array(${data.length})` : `Object(${entries.length})`;

  return (
    <Box>
      <UnstyledButton onClick={() => setExpanded((e) => !e)}>
        <Text size="xs" c="blue" span>
          {expanded ? '[-]' : '[+]'} {label}
        </Text>
      </UnstyledButton>
      <Collapse in={expanded}>
        <Box pl="md" style={{ borderLeft: '1px solid var(--mantine-color-gray-3)' }}>
          {entries.map(([key, value]) => (
            <Group key={key} gap="xs" align="flex-start" wrap="nowrap" mt={2}>
              <Text size="xs" fw={600} c="dimmed" style={{ minWidth: 60, flexShrink: 0 }}>
                {key}:
              </Text>
              <Box style={{ minWidth: 0 }}>
                <JsonTree data={value} depth={depth + 1} />
              </Box>
            </Group>
          ))}
        </Box>
      </Collapse>
    </Box>
  );
}

/**
 * Render a field value with media detection.
 */
function FieldValue({ fieldKey, value }: { fieldKey: string; value: unknown }) {
  // Handle string values that might be media paths
  if (typeof value === 'string' && value.length > 0) {
    if (isImagePath(value)) {
      const url = getMediaUrl(value);
      return (
        <Stack gap="xs">
          <Image src={url} maw={300} mah={200} fit="contain" radius="sm" />
          <Text size="xs" c="dimmed">
            {value}
          </Text>
        </Stack>
      );
    }

    if (isAudioPath(value)) {
      const url = getMediaUrl(value);
      return (
        <Stack gap="xs">
          <audio controls style={{ maxWidth: '100%' }}>
            <source src={url} />
            Your browser does not support the audio element.
          </audio>
          <Text size="xs" c="dimmed">
            {value}
          </Text>
        </Stack>
      );
    }

    if (isVideoPath(value)) {
      const url = getMediaUrl(value);
      return (
        <Stack gap="xs">
          <video controls style={{ maxWidth: '100%', maxHeight: 300 }}>
            <source src={url} />
            Your browser does not support the video element.
          </video>
          <Text size="xs" c="dimmed">
            {value}
          </Text>
        </Stack>
      );
    }

    // Long text
    if (value.length > 200) {
      return (
        <Code
          block
          style={{
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            maxHeight: 200,
            overflow: 'auto',
          }}
        >
          {value}
        </Code>
      );
    }

    return <Text size="sm">{value}</Text>;
  }

  // Handle nested objects/arrays
  if (typeof value === 'object' && value !== null) {
    return <JsonTree data={value} />;
  }

  // Handle primitives
  if (value === null || value === undefined) {
    return (
      <Text size="sm" c="dimmed" fs="italic">
        null
      </Text>
    );
  }

  if (typeof value === 'boolean') {
    return (
      <Text size="sm" c={value ? 'green' : 'red'}>
        {String(value)}
      </Text>
    );
  }

  if (typeof value === 'number') {
    return (
      <Text size="sm" ff="monospace">
        {value}
      </Text>
    );
  }

  return <Text size="sm">{String(value)}</Text>;
}

export function RecordDetail({ record, onClose }: RecordDetailProps) {
  const { t } = useTranslation();
  return (
    <Drawer
      opened={record !== null}
      onClose={onClose}
      title={t('dataViewer.recordDetail')}
      position="right"
      size="lg"
      padding="md"
    >
      {record && (
        <Stack gap="md">
          {Object.entries(record).map(([key, value]) => (
            <Box key={key}>
              <Text size="xs" fw={700} c="dimmed" mb={4} tt="uppercase">
                {key}
              </Text>
              <FieldValue fieldKey={key} value={value} />
            </Box>
          ))}
        </Stack>
      )}
    </Drawer>
  );
}
