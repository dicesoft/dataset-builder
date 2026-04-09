import { useState, useCallback } from 'react';
import { apiPost } from '../utils/api';
import { useJobStore, type JobRecord } from '../stores/jobStore';

interface UseJobReturn {
  submitJob: (command: string, options?: Record<string, unknown>) => Promise<string>;
  cancelJob: (jobId: string) => Promise<void>;
  jobId: string | null;
  isSubmitting: boolean;
  error: string | null;
}

export function useJob(): UseJobReturn {
  const [jobId, setJobId] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const addJob = useJobStore((s) => s.addJob);

  const submitJob = useCallback(
    async (command: string, options?: Record<string, unknown>): Promise<string> => {
      setIsSubmitting(true);
      setError(null);
      try {
        const job = await apiPost<JobRecord>('/api/v1/jobs', {
          command,
          options,
        });
        addJob(job);
        setJobId(job.id);
        return job.id;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to submit job';
        setError(message);
        throw err;
      } finally {
        setIsSubmitting(false);
      }
    },
    [addJob]
  );

  const cancelJob = useCallback(async (id: string): Promise<void> => {
    await apiPost<void>(`/api/v1/jobs/${id}/cancel`);
  }, []);

  return { submitJob, cancelJob, jobId, isSubmitting, error };
}
