/**
 * Transform Decision Log
 * Collects per-record decisions during the transform pipeline for traceability
 */

/** Pipeline stage where a decision was made */
export type DecisionStage = 'filter' | 'classify' | 'threshold' | 'generate' | 'quality';

/** Action taken on the record */
export type DecisionAction = 'keep' | 'drop' | 'fallback';

/** A single decision entry in the log */
export interface DecisionEntry {
  /** Record identifier (asset ID, page ID, etc.) */
  recordId: string;
  /** ISO timestamp of the decision */
  timestamp: string;
  /** Pipeline stage */
  stage: DecisionStage;
  /** Action taken */
  action: DecisionAction;
  /** Human-readable reason */
  reason: string;
  /** Optional extra details */
  details?: Record<string, unknown>;
}

/** Summary counts grouped by stage and action */
export interface DecisionSummary {
  byStage: Record<string, { keep: number; drop: number; fallback: number }>;
  totals: { keep: number; drop: number; fallback: number };
}

/**
 * Collects per-record decisions during the transform pipeline.
 * Used to produce a JSONL decision log alongside the output.
 */
export class TransformDecisionLog {
  private entries: DecisionEntry[] = [];

  /**
   * Log a decision entry
   */
  log(entry: Omit<DecisionEntry, 'timestamp'>): void {
    this.entries.push({
      ...entry,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Get all logged entries
   */
  getEntries(): DecisionEntry[] {
    return this.entries;
  }

  /**
   * Get a summary of decisions grouped by stage and action
   */
  getSummary(): DecisionSummary {
    const byStage: Record<string, { keep: number; drop: number; fallback: number }> = {};
    const totals = { keep: 0, drop: 0, fallback: 0 };

    for (const entry of this.entries) {
      if (!byStage[entry.stage]) {
        byStage[entry.stage] = { keep: 0, drop: 0, fallback: 0 };
      }
      byStage[entry.stage][entry.action]++;
      totals[entry.action]++;
    }

    return { byStage, totals };
  }

  /**
   * Serialize entries to JSONL format (one JSON object per line)
   */
  toJsonl(): string {
    return this.entries.map((entry) => JSON.stringify(entry)).join('\n');
  }
}
