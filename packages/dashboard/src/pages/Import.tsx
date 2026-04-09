import { useCallback, useState } from 'react';
import {
  Alert,
  Button,
  Container,
  Group,
  Loader,
  Paper,
  Select,
  Stack,
  Table,
  Text,
  Title,
} from '@mantine/core';
import { Dropzone, MIME_TYPES, type FileRejection } from '@mantine/dropzone';
import { useTranslation } from 'react-i18next';
import { useJob } from '@/hooks/useJob';
import { ProgressPanel } from '@/components/ProgressPanel/ProgressPanel';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface UploadResult {
  filePath: string;
  originalName: string;
  mimetype: string;
  size: number;
}

interface PreviewData {
  records: Record<string, unknown>[];
  fields: string[];
  sheets?: string[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ACCEPTED_TYPES = [
  MIME_TYPES.csv,
  MIME_TYPES.xlsx,
  MIME_TYPES.xls,
  'application/json',
  'application/x-ndjson',
  'text/xml',
  'application/xml',
  'text/plain',
];

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function Import() {
  const { t } = useTranslation();
  const { submitJob, jobId, isSubmitting, error: submitError } = useJob();

  // Upload state
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<UploadResult | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [rejectError, setRejectError] = useState<string | null>(null);

  // Preview state
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [selectedSheet, setSelectedSheet] = useState<string | null>(null);

  // Handle rejected files from Dropzone
  const handleReject = useCallback((rejections: FileRejection[]) => {
    const messages = rejections.map((r) => {
      const reasons = r.errors.map((e) => e.message).join(', ');
      return `${r.file.name}: ${reasons}`;
    });
    setRejectError(messages.join('; '));
  }, []);

  // Handle file upload
  const handleDrop = useCallback(async (files: File[]) => {
    if (files.length === 0) return;

    const file = files[0];
    setUploading(true);
    setUploadError(null);
    setRejectError(null);
    setUploadResult(null);
    setPreview(null);
    setPreviewError(null);
    setSelectedSheet(null);

    try {
      const formData = new FormData();
      formData.append('file', file);

      const res = await fetch('/api/v1/upload', {
        method: 'POST',
        body: formData,
      });

      const envelope = await res.json();
      if (!envelope.success) {
        throw new Error(envelope.error?.message ?? 'Upload failed');
      }

      const result: UploadResult = envelope.data;
      setUploadResult(result);

      // Fetch preview
      await loadPreview(result.filePath);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  }, []);

  // Load preview data
  const loadPreview = useCallback(async (filePath: string, sheet?: string) => {
    setPreviewLoading(true);
    setPreviewError(null);
    try {
      const params = new URLSearchParams({ filePath });
      if (sheet) params.set('sheet', sheet);

      const res = await fetch(`/api/v1/import/preview?${params.toString()}`);
      const envelope = await res.json();

      if (envelope.success && envelope.data) {
        setPreview(envelope.data);
      } else {
        setPreviewError(envelope.error?.message ?? 'Failed to load preview');
      }
    } catch (err) {
      setPreviewError(err instanceof Error ? err.message : 'Failed to load preview');
    } finally {
      setPreviewLoading(false);
    }
  }, []);

  // Handle sheet change for Excel files
  const handleSheetChange = useCallback(
    (value: string | null) => {
      setSelectedSheet(value);
      if (uploadResult && value) {
        loadPreview(uploadResult.filePath, value);
      }
    },
    [uploadResult, loadPreview]
  );

  // Handle confirm import
  const handleConfirm = useCallback(async () => {
    if (!uploadResult) return;
    await submitJob('import', {
      filePath: uploadResult.filePath,
      ...(selectedSheet ? { sheet: selectedSheet } : {}),
    });
  }, [submitJob, uploadResult, selectedSheet]);

  // Handle cancel / reset
  const handleCancel = useCallback(() => {
    // Clean up uploaded file on the server
    if (uploadResult) {
      const filename = uploadResult.filePath.split('/').pop();
      if (filename) {
        fetch(`/api/v1/upload/${encodeURIComponent(filename)}`, { method: 'DELETE' }).catch(
          () => {}
        );
      }
    }
    setUploadResult(null);
    setPreview(null);
    setPreviewError(null);
    setSelectedSheet(null);
    setUploadError(null);
    setRejectError(null);
  }, [uploadResult]);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <Container size="lg" py="md">
      <Stack gap="lg">
        <div>
          <Title order={2} mb={4}>
            {t('import.title')}
          </Title>
          <Text c="dimmed" size="sm">
            {t('import.description')}
          </Text>
        </div>

        {/* Error alerts */}
        {(uploadError || submitError) && (
          <Alert color="red" title={t('common.error')}>
            {uploadError ?? submitError}
          </Alert>
        )}

        {rejectError && (
          <Alert
            color="orange"
            title="File rejected"
            withCloseButton
            onClose={() => setRejectError(null)}
          >
            {rejectError}
          </Alert>
        )}

        {previewError && (
          <Alert
            color="red"
            title="Preview failed"
            withCloseButton
            onClose={() => setPreviewError(null)}
          >
            {previewError}
          </Alert>
        )}

        {/* Progress panel when job submitted */}
        {jobId && <ProgressPanel jobId={jobId} />}

        {/* Dropzone — show when no file uploaded yet */}
        {!uploadResult && !jobId && (
          <Dropzone
            onDrop={handleDrop}
            onReject={handleReject}
            accept={ACCEPTED_TYPES}
            maxFiles={1}
            loading={uploading}
          >
            <Stack align="center" gap="sm" py="xl">
              <Text size="lg" fw={500}>
                {t('import.dropzone')}
              </Text>
              <Text size="sm" c="dimmed">
                {t('import.dropzoneHint')}
              </Text>
            </Stack>
          </Dropzone>
        )}

        {/* Upload result + preview */}
        {uploadResult && !jobId && (
          <Stack gap="md">
            {/* File info */}
            <Paper p="sm" withBorder>
              <Text size="sm" fw={500}>
                {t('import.fileInfo', {
                  name: uploadResult.originalName,
                  size: formatSize(uploadResult.size),
                })}
              </Text>
            </Paper>

            {/* Sheet selector for Excel files */}
            {preview?.sheets && preview.sheets.length > 1 && (
              <Select
                label={t('import.sheet')}
                description={t('import.sheetHint')}
                data={preview.sheets.map((s) => ({ value: s, label: s }))}
                value={selectedSheet}
                onChange={handleSheetChange}
                clearable
              />
            )}

            {/* Preview table */}
            {previewLoading ? (
              <Group>
                <Loader size="sm" />
                <Text size="sm">{t('common.loading')}</Text>
              </Group>
            ) : preview && preview.records.length > 0 ? (
              <Paper withBorder>
                <Stack gap="xs" p="sm">
                  <Text size="sm" fw={500}>
                    {t('import.preview')}
                  </Text>
                  <Text size="xs" c="dimmed">
                    {t('import.previewHint')}
                  </Text>
                </Stack>
                <Table striped highlightOnHover withColumnBorders>
                  <Table.Thead>
                    <Table.Tr>
                      {preview.fields.map((field) => (
                        <Table.Th key={field}>{field}</Table.Th>
                      ))}
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {preview.records.slice(0, 10).map((record, idx) => (
                      <Table.Tr key={idx}>
                        {preview.fields.map((field) => (
                          <Table.Td key={field}>
                            {record[field] != null ? String(record[field]) : ''}
                          </Table.Td>
                        ))}
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </Paper>
            ) : preview ? (
              <Text size="sm" c="dimmed">
                {t('import.noRecords')}
              </Text>
            ) : null}

            {/* Action buttons */}
            <Group justify="flex-end">
              <Button variant="default" onClick={handleCancel}>
                {t('common.cancel')}
              </Button>
              <Button onClick={handleConfirm} loading={isSubmitting}>
                {t('import.confirmImport')}
              </Button>
            </Group>
          </Stack>
        )}
      </Stack>
    </Container>
  );
}
