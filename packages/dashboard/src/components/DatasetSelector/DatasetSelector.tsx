import { useMemo } from 'react';
import { Alert, Loader, Select, Text } from '@mantine/core';
import { useTranslation } from 'react-i18next';

/**
 * Minimal shape of a dataset entry needed for the selector.
 * Both `DatasetEntry` (pages using `apiGet` directly) and `DatasetInfo`
 * (pages using the `useDataset` hook) satisfy this shape.
 */
export interface DatasetSelectorEntry {
  name: string;
  path: string;
  recordCount: number;
}

export interface DatasetSelectorProps {
  /** List of available datasets. */
  datasets: DatasetSelectorEntry[];
  /** True while the initial fetch is in flight (optional — not all callers track it). */
  isLoading?: boolean;
  /** Non-null when the datasets fetch failed — rendered as a red Alert. */
  fetchError?: string | null;
  /** Currently selected dataset path. */
  value: string | null;
  /** Called when the user changes the selection. */
  onChange: (value: string | null) => void;
  /** Localized label for the Select. */
  label?: string;
  /**
   * Optional error message for the Select (e.g. local validation "please
   * pick a dataset"). Wires through to Mantine's `error` prop so the field
   * shows `aria-invalid` when set.
   */
  error?: string;
  /** When true, renders the field with a red asterisk to signal it's required. */
  required?: boolean;
  /** Placeholder text shown before a value is chosen. */
  placeholder?: string;
  /** When true, the empty-state and fetch-error Alerts are suppressed while loading. */
  suppressEmptyStateWhileLoading?: boolean;
}

/**
 * Shared dataset selector used by Transform / Format / Clean / Translate pages.
 *
 * Encapsulates three render branches so all four pages behave identically:
 *  1. **fetch error** — red Alert explaining the server could not be reached
 *     (surfaces Phase 5.2's `datasetsError` state distinctly from "empty list").
 *  2. **empty list** — blue Alert pointing the user at `/import`.
 *  3. **normal** — Mantine `<Select>` with `withAsterisk` + `error` wiring
 *     (Phase 2.5) so screen readers and visual users both see the required /
 *     invalid state.
 *
 * Replaces the per-page duplication of label / empty-state / Select config
 * that had drifted across pages (see master-plan.md §3.3).
 */
export function DatasetSelector({
  datasets,
  isLoading = false,
  fetchError = null,
  value,
  onChange,
  label,
  error,
  required = false,
  placeholder,
  suppressEmptyStateWhileLoading = false,
}: DatasetSelectorProps) {
  const { t } = useTranslation();

  const datasetData = useMemo(
    () =>
      datasets.map((d) => ({
        value: d.path,
        label: `${d.name} (${d.recordCount} ${t('common.records')})`,
      })),
    [datasets, t]
  );

  // Branch 1: server-side fetch failure — distinguish from "no datasets yet".
  if (fetchError) {
    return (
      <Alert color="red" variant="light" title={t('common.error')}>
        {t('common.datasetsLoadFailed', 'Failed to load datasets from the server.')}{' '}
        <Text size="sm" span>
          {fetchError}
        </Text>
      </Alert>
    );
  }

  // Branch 2: empty list (but only once we're sure loading is done).
  if (datasets.length === 0 && !(suppressEmptyStateWhileLoading && isLoading)) {
    return (
      <Alert color="blue" variant="light">
        {t('common.noDatasetsFound')}{' '}
        <Text component="a" href="/import" size="sm" c="blue" td="underline" span>
          {t('common.importDataFirst')}
        </Text>
      </Alert>
    );
  }

  // Branch 3: normal select.
  return (
    <Select
      label={label}
      placeholder={placeholder ?? t('common.noDatasetSelected')}
      data={datasetData}
      value={value}
      onChange={onChange}
      clearable
      searchable
      withAsterisk={required}
      error={error}
      rightSection={isLoading ? <Loader size="xs" /> : undefined}
    />
  );
}
