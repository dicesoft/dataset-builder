/**
 * T048: useDataset hook
 * Fetches datasets list and paginated records from the datasets API.
 */

import { useState, useCallback } from 'react';
import { apiGet } from '../utils/api';

export interface DatasetInfo {
  path: string;
  name: string;
  type: 'json' | 'jsonl' | 'csv';
  size: number;
  recordCount: number;
  modifiedAt: string;
  fields: string[];
}

export interface PaginatedRecords {
  records: Record<string, unknown>[];
  total: number;
  page: number;
  pageSize: number;
  fields: string[];
}

interface UseDatasetReturn {
  datasets: DatasetInfo[];
  records: Record<string, unknown>[];
  total: number;
  fields: string[];
  loading: boolean;
  error: string | null;
  fetchDatasets: () => Promise<void>;
  fetchRecords: (
    datasetPath: string,
    page?: number,
    pageSize?: number,
    sort?: string,
    filter?: string,
    search?: string
  ) => Promise<void>;
}

export function useDataset(): UseDatasetReturn {
  const [datasets, setDatasets] = useState<DatasetInfo[]>([]);
  const [records, setRecords] = useState<Record<string, unknown>[]>([]);
  const [total, setTotal] = useState(0);
  const [fields, setFields] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchDatasets = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiGet<{ datasets: DatasetInfo[] }>('/api/v1/datasets');
      setDatasets(data.datasets);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch datasets';
      setError(message);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchRecords = useCallback(
    async (
      datasetPath: string,
      page = 1,
      pageSize = 50,
      sort?: string,
      filter?: string,
      search?: string
    ) => {
      setLoading(true);
      setError(null);
      try {
        const encodedPath = encodeURIComponent(datasetPath);
        const params = new URLSearchParams();
        params.set('page', String(page));
        params.set('pageSize', String(pageSize));
        if (sort) params.set('sort', sort);
        if (filter) params.set('filter', filter);
        if (search) params.set('search', search);

        const data = await apiGet<PaginatedRecords>(
          `/api/v1/datasets/${encodedPath}/records?${params.toString()}`
        );
        setRecords(data.records);
        setTotal(data.total);
        setFields(data.fields);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to fetch records';
        setError(message);
      } finally {
        setLoading(false);
      }
    },
    []
  );

  return { datasets, records, total, fields, loading, error, fetchDatasets, fetchRecords };
}
