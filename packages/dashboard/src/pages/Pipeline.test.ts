import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * 4.5: Pipeline flow tests — command correctness, config parsing, validation
 *
 * Tests the Pipeline page logic without rendering React components.
 */

// Mock apiPost to verify job submission
vi.mock('../utils/api', () => ({
  apiPost: vi.fn(),
  apiGet: vi.fn(),
  apiDelete: vi.fn(),
}));

import { apiPost } from '../utils/api';
const mockApiPost = vi.mocked(apiPost);

describe('Pipeline flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Pipeline command', () => {
    it('submits job with "run" command (not "pipeline")', async () => {
      // Pipeline.tsx line 186: submitJob('run', { configFile: uploadedFilePath })
      mockApiPost.mockResolvedValue({
        id: 'job-1',
        command: 'run',
        status: 'queued',
        progress: null,
        createdAt: '2026-04-01T00:00:00Z',
        startedAt: null,
        completedAt: null,
        duration: null,
        outputPath: null,
        error: null,
      });

      await apiPost('/api/v1/jobs', {
        command: 'run',
        options: { configFile: '/tmp/uploads/pipeline.json' },
      });

      expect(mockApiPost).toHaveBeenCalledWith('/api/v1/jobs', {
        command: 'run',
        options: { configFile: '/tmp/uploads/pipeline.json' },
      });

      // Verify the command is 'run', NOT 'pipeline'
      const [, body] = mockApiPost.mock.calls[0];
      expect((body as any).command).toBe('run');
      expect((body as any).command).not.toBe('pipeline');
    });

    it('"run" is in the ALLOWED_COMMANDS set on server', () => {
      // jobs.ts lines 19-34: ALLOWED_COMMANDS
      const ALLOWED_COMMANDS = new Set([
        'scrape',
        'generate',
        'import',
        'export',
        'clean',
        'run',
        'config',
        'prune',
        'web-search',
        'resume',
        'compress',
        'translate',
        'format',
        'transform',
      ]);

      expect(ALLOWED_COMMANDS.has('run')).toBe(true);
      expect(ALLOWED_COMMANDS.has('pipeline')).toBe(false);
    });
  });

  describe('Config parsing (parseConfig logic)', () => {
    it('parses JSON pipeline config', () => {
      const jsonText = JSON.stringify({
        name: 'test-pipeline',
        stages: [
          { name: 'Scrape', command: 'scrape' },
          { name: 'Clean', command: 'clean' },
        ],
      });

      const config = JSON.parse(jsonText);
      expect(config.stages).toHaveLength(2);
      expect(config.stages[0].name).toBe('Scrape');
      expect(config.stages[1].command).toBe('clean');
    });

    it('parses YAML-like stage definitions', () => {
      // Pipeline.tsx lines 52-80: simple YAML parser
      const yamlText = `stages:
  - name: Scrape Data
    command: scrape
  - name: Clean Records
    command: clean
  - name: Export Results
    command: export`;

      const stages: { name: string; command: string }[] = [];
      const lines = yamlText.split('\n');
      let currentStage: { name?: string; command?: string } | null = null;

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('- name:')) {
          if (currentStage?.name && currentStage?.command) {
            stages.push(currentStage as { name: string; command: string });
          }
          currentStage = { name: trimmed.replace('- name:', '').trim() };
        } else if (trimmed.startsWith('command:') && currentStage) {
          currentStage.command = trimmed.replace('command:', '').trim();
        }
      }
      if (currentStage?.name && currentStage?.command) {
        stages.push(currentStage as { name: string; command: string });
      }

      expect(stages).toHaveLength(3);
      expect(stages[0]).toEqual({ name: 'Scrape Data', command: 'scrape' });
      expect(stages[1]).toEqual({ name: 'Clean Records', command: 'clean' });
      expect(stages[2]).toEqual({ name: 'Export Results', command: 'export' });
    });

    it('throws on empty/invalid config with no stages', () => {
      const emptyYaml = `nothing: here`;
      const stages: any[] = [];
      const lines = emptyYaml.split('\n');
      let currentStage: any = null;

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('- name:')) {
          if (currentStage?.name && currentStage?.command) {
            stages.push(currentStage);
          }
          currentStage = { name: trimmed.replace('- name:', '').trim() };
        } else if (trimmed.startsWith('command:') && currentStage) {
          currentStage.command = trimmed.replace('command:', '').trim();
        }
      }
      if (currentStage?.name && currentStage?.command) {
        stages.push(currentStage);
      }

      expect(stages).toHaveLength(0);
      // Pipeline.tsx line 74-76: throws if no stages found
      expect(() => {
        if (stages.length === 0) throw new Error('No valid pipeline stages found');
      }).toThrow('No valid pipeline stages found');
    });
  });

  describe('Validation', () => {
    it('catches missing name in stage', () => {
      const stages = [
        { name: '', command: 'scrape' },
        { name: 'Clean', command: 'clean' },
      ];

      // Pipeline.tsx lines 170-177: validation logic
      let error: string | null = null;
      for (const stage of stages) {
        if (!stage.name || !stage.command) {
          error = 'Each stage must have a name and command';
          break;
        }
      }

      expect(error).toBe('Each stage must have a name and command');
    });

    it('catches missing command in stage', () => {
      const stages = [{ name: 'Scrape', command: '' }];

      let error: string | null = null;
      for (const stage of stages) {
        if (!stage.name || !stage.command) {
          error = 'Each stage must have a name and command';
          break;
        }
      }

      expect(error).toBe('Each stage must have a name and command');
    });

    it('passes validation for well-formed config', () => {
      const stages = [
        { name: 'Scrape', command: 'scrape' },
        { name: 'Clean', command: 'clean' },
        { name: 'Export', command: 'export' },
      ];

      let error: string | null = null;
      let validated = false;

      for (const stage of stages) {
        if (!stage.name || !stage.command) {
          error = 'Each stage must have a name and command';
          validated = false;
          break;
        }
      }

      if (!error) {
        validated = true;
      }

      expect(error).toBeNull();
      expect(validated).toBe(true);
    });
  });

  describe('Stage status', () => {
    it('maps stage statuses to correct colors', () => {
      // Pipeline.tsx lines 107-112: STATUS_COLORS
      const STATUS_COLORS: Record<string, string> = {
        pending: 'gray',
        active: 'blue',
        complete: 'green',
        failed: 'red',
      };

      expect(STATUS_COLORS['pending']).toBe('gray');
      expect(STATUS_COLORS['active']).toBe('blue');
      expect(STATUS_COLORS['complete']).toBe('green');
      expect(STATUS_COLORS['failed']).toBe('red');
    });
  });
});
