/**
 * T051: GalleryView component
 * Image thumbnail grid from media URLs via /api/v1/media/.
 * Click to open larger view in a Mantine Modal.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  SimpleGrid,
  Image,
  Card,
  Modal,
  Text,
  Group,
  Stack,
  Badge,
  Center,
  Loader,
  Switch,
} from '@mantine/core';
import { useTranslation } from 'react-i18next';
import { apiGet } from '../../utils/api';

interface GalleryViewProps {
  records: Record<string, unknown>[];
  mediaFields: string[];
  datasetPath?: string;
  pageSize?: number;
}

interface ManifestEntry {
  sourceUrl: string;
  localPath: string;
}

interface ManifestResponse {
  manifest: { assets: ManifestEntry[] } | null;
  sourceUrls: ManifestEntry[];
}

function getMediaUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0) return null;
  // If the value is already a full URL, use it directly
  if (value.startsWith('http://') || value.startsWith('https://')) return value;
  // Otherwise, serve via the media endpoint
  return `/api/v1/media/${encodeURIComponent(value)}`;
}

function isImageUrl(url: string): boolean {
  const lower = url.toLowerCase();
  return (
    lower.includes('.jpg') ||
    lower.includes('.jpeg') ||
    lower.includes('.png') ||
    lower.includes('.gif') ||
    lower.includes('.webp') ||
    lower.includes('.svg')
  );
}

interface ModalContent {
  url: string;
  record: Record<string, unknown>;
  field: string;
}

export function GalleryView({
  records,
  mediaFields,
  datasetPath,
  pageSize = 24,
}: GalleryViewProps) {
  const { t } = useTranslation();
  const [modalContent, setModalContent] = useState<ModalContent | null>(null);
  const [visibleCount, setVisibleCount] = useState(pageSize);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const [manifestMap, setManifestMap] = useState<Map<string, string> | null>(null);
  const [showAll, setShowAll] = useState(false);

  // Fetch downloads manifest for the dataset (if any) so we can filter
  // the gallery to only show images that were actually downloaded.
  useEffect(() => {
    if (!datasetPath) {
      setManifestMap(null);
      return;
    }
    let cancelled = false;
    const url = `/api/v1/datasets/${encodeURIComponent(datasetPath)}/manifest`;
    apiGet<ManifestResponse>(url)
      .then((data) => {
        if (cancelled) return;
        if (!data?.sourceUrls?.length) {
          setManifestMap(null);
          return;
        }
        const map = new Map<string, string>();
        for (const entry of data.sourceUrls) {
          map.set(entry.sourceUrl, entry.localPath);
        }
        setManifestMap(map);
      })
      .catch(() => {
        if (!cancelled) setManifestMap(null);
      });
    return () => {
      cancelled = true;
    };
  }, [datasetPath]);

  // Build a flat list of image items from records.
  // When a manifest is available and "Show all" is off, only include images
  // that were actually downloaded, served via /api/v1/media/<localPath>.
  const items = useMemo(() => {
    const result: {
      url: string;
      record: Record<string, unknown>;
      field: string;
      index: number;
      downloaded: boolean;
    }[] = [];
    const filterToDownloaded = manifestMap !== null && !showAll;

    const tryAdd = (
      rawValue: unknown,
      record: Record<string, unknown>,
      field: string,
      i: number
    ) => {
      if (typeof rawValue !== 'string' || rawValue.length === 0) return;
      const localPath = manifestMap?.get(rawValue);
      const isDownloaded = !!localPath;
      if (filterToDownloaded && !isDownloaded) return;
      // Prefer local file when available — faster and works offline
      const url = isDownloaded
        ? `/api/v1/media/${encodeURIComponent(localPath!)}`
        : getMediaUrl(rawValue);
      if (url && (isImageUrl(url) || isDownloaded)) {
        result.push({ url, record, field, index: i, downloaded: isDownloaded });
      }
    };

    for (let i = 0; i < records.length; i++) {
      const record = records[i];
      for (const field of mediaFields) {
        const value = record[field];
        if (Array.isArray(value)) {
          for (const item of value) tryAdd(item, record, field, i);
        } else {
          tryAdd(value, record, field, i);
        }
      }
    }
    return result;
  }, [records, mediaFields, manifestMap, showAll]);

  const hasMore = visibleCount < items.length;
  const visibleItems = items.slice(0, visibleCount);
  const downloadedCount = manifestMap?.size ?? 0;

  // Reset visible count when records change
  useEffect(() => {
    setVisibleCount(pageSize);
  }, [records, pageSize]);

  // Intersection Observer for infinite scroll
  const observerCallback = useCallback(
    (entries: IntersectionObserverEntry[]) => {
      if (entries[0]?.isIntersecting && hasMore) {
        setVisibleCount((prev) => Math.min(prev + pageSize, items.length));
      }
    },
    [hasMore, pageSize, items.length]
  );

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(observerCallback, {
      rootMargin: '200px',
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [observerCallback]);

  // Toggle is shown when a manifest exists (so user can switch between
  // "downloaded only" and "all extracted URLs")
  const toggle = manifestMap !== null && (
    <Group justify="space-between" mb="sm">
      <Text size="sm" c="dimmed">
        {showAll
          ? t('dataViewer.gallery.showingAll', 'Showing all extracted images')
          : t('dataViewer.gallery.showingDownloaded', 'Showing downloaded images only') +
            ` (${downloadedCount})`}
      </Text>
      <Switch
        checked={showAll}
        onChange={(e) => setShowAll(e.currentTarget.checked)}
        label={t('dataViewer.gallery.showAll', 'Show all extracted')}
        size="sm"
      />
    </Group>
  );

  if (items.length === 0) {
    return (
      <>
        {toggle}
        <Card withBorder p="xl" ta="center">
          <Text c="dimmed">{t('dataViewer.noImages')}</Text>
          <Text size="xs" c="dimmed" mt="xs">
            {t('dataViewer.mediaFieldsChecked')} {mediaFields.join(', ') || 'none detected'}
          </Text>
        </Card>
      </>
    );
  }

  return (
    <>
      {toggle}
      <SimpleGrid cols={{ base: 2, xs: 3, sm: 4, md: 6 }} spacing="sm">
        {visibleItems.map((item, idx) => (
          <Card
            key={`${item.index}-${item.field}-${idx}`}
            withBorder
            p={0}
            style={{ cursor: 'pointer', overflow: 'hidden' }}
            onClick={() =>
              setModalContent({ url: item.url, record: item.record, field: item.field })
            }
          >
            <Image
              src={item.url}
              h={140}
              fit="cover"
              alt={
                typeof item.record[item.field] === 'string'
                  ? `${item.field}: ${(item.record[item.field] as string).split('/').pop()}`
                  : `Image ${item.index} - ${item.field}`
              }
              fallbackSrc="data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTAwIiBoZWlnaHQ9IjEwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMTAwIiBoZWlnaHQ9IjEwMCIgZmlsbD0iI2VlZSIvPjx0ZXh0IHg9IjUwJSIgeT0iNTAlIiBkb21pbmFudC1iYXNlbGluZT0ibWlkZGxlIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBmaWxsPSIjOTk5IiBmb250LXNpemU9IjEyIj5ObyBpbWFnZTwvdGV4dD48L3N2Zz4="
            />
            <Group p={4} gap={4} wrap="nowrap">
              <Badge size="xs" variant="light" color="gray">
                {item.field}
              </Badge>
              <Text size="xs" c="dimmed" truncate>
                #{item.index}
              </Text>
            </Group>
          </Card>
        ))}
      </SimpleGrid>

      {/* Infinite scroll sentinel */}
      <div ref={sentinelRef} style={{ height: 1 }} />
      {hasMore && (
        <Center mt="md">
          <Loader size="sm" />
        </Center>
      )}

      <Modal
        opened={modalContent !== null}
        onClose={() => setModalContent(null)}
        size="xl"
        title={
          modalContent
            ? `Record #${records.indexOf(modalContent.record)} - ${modalContent.field}`
            : ''
        }
      >
        {modalContent && (
          <Stack gap="md">
            <Image
              src={modalContent.url}
              mah="60vh"
              fit="contain"
              alt={`${modalContent.field} - Record #${records.indexOf(modalContent.record)}`}
            />
            <Stack gap="xs">
              {Object.entries(modalContent.record).map(([key, value]) => (
                <Group key={key} gap="xs" wrap="nowrap">
                  <Text size="xs" fw={600} c="dimmed" style={{ minWidth: 100 }}>
                    {key}:
                  </Text>
                  <Text size="xs" lineClamp={2}>
                    {typeof value === 'object' ? JSON.stringify(value) : String(value ?? '')}
                  </Text>
                </Group>
              ))}
            </Stack>
          </Stack>
        )}
      </Modal>
    </>
  );
}
