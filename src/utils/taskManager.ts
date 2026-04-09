/**
 * Task organization system for managing output files
 * Organizes files into task-specific folders with metadata
 */

import fs from 'fs/promises';
import path from 'path';

export interface TaskInfo {
  id: string;
  taskType?: 'scrape' | 'generate' | 'resume' | 'clean' | 'import' | 'export' | 'translate';
  command: string;
  timestamp: number;
  status: 'running' | 'completed' | 'failed';
  metadata?: Record<string, unknown>;
}

/**
 * Generate a unique task ID
 * Format: task_ + timestamp + random string (sortable, unique)
 */
export function generateTaskId(): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 11);
  return `task_${timestamp}_${random}`;
}

/**
 * Get the output path for a task subfolder
 */
export function getTaskOutputPath(
  taskId: string,
  subfolder?: string,
  baseOutputDir?: string
): string {
  const baseDir = baseOutputDir || './output';
  if (subfolder) {
    return path.resolve(baseDir, taskId, subfolder);
  }
  return path.resolve(baseDir, taskId);
}

/**
 * Create task folder structure with subfolders for different data types
 */
export async function createTaskStructure(
  taskId: string,
  subfolders: string[] = ['scraped', 'downloads', 'images', 'generated', 'cleaned'],
  baseOutputDir?: string
): Promise<string> {
  const taskDir = getTaskOutputPath(taskId, undefined, baseOutputDir);

  // Create main task directory
  await fs.mkdir(taskDir, { recursive: true });

  // Create subfolders
  for (const subfolder of subfolders) {
    await fs.mkdir(path.join(taskDir, subfolder), { recursive: true });
  }

  return taskDir;
}

/**
 * Create task metadata file
 */
export async function createTaskMetadata(
  taskId: string,
  command: string,
  baseOutputDir?: string,
  metadata?: Record<string, unknown>,
  taskType?: TaskInfo['taskType']
): Promise<void> {
  const taskDir = getTaskOutputPath(taskId, undefined, baseOutputDir);
  const metadataPath = path.join(taskDir, 'metadata.json');

  const taskInfo: TaskInfo = {
    id: taskId,
    taskType,
    command,
    timestamp: Date.now(),
    status: 'running',
    metadata,
  };

  await fs.writeFile(metadataPath, JSON.stringify(taskInfo, null, 2), 'utf-8');
}

/**
 * Update task status
 */
export async function updateTaskStatus(
  taskId: string,
  status: TaskInfo['status'],
  baseOutputDir?: string
): Promise<void> {
  const taskDir = getTaskOutputPath(taskId, undefined, baseOutputDir);
  const metadataPath = path.join(taskDir, 'metadata.json');

  try {
    const content = await fs.readFile(metadataPath, 'utf-8');
    const taskInfo: TaskInfo = JSON.parse(content);
    taskInfo.status = status;
    await fs.writeFile(metadataPath, JSON.stringify(taskInfo, null, 2), 'utf-8');
  } catch {
    // If metadata doesn't exist, skip update
  }
}

/**
 * Get task info from metadata
 */
export async function getTaskInfo(
  taskId: string,
  baseOutputDir?: string
): Promise<TaskInfo | null> {
  const taskDir = getTaskOutputPath(taskId, undefined, baseOutputDir);
  const metadataPath = path.join(taskDir, 'metadata.json');

  try {
    const content = await fs.readFile(metadataPath, 'utf-8');
    return JSON.parse(content) as TaskInfo;
  } catch {
    return null;
  }
}

/**
 * List all tasks
 */
export async function listTasks(baseOutputDir?: string): Promise<TaskInfo[]> {
  const baseDir = baseOutputDir || './output';
  const tasks: TaskInfo[] = [];

  try {
    const entries = await fs.readdir(baseDir, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isDirectory() && entry.name.startsWith('task_')) {
        const taskInfo = await getTaskInfo(entry.name, baseOutputDir);
        if (taskInfo) {
          tasks.push(taskInfo);
        }
      }
    }
  } catch {
    // Directory doesn't exist or can't be read
  }

  return tasks.sort((a, b) => b.timestamp - a.timestamp);
}

/**
 * Get file path within a task subfolder
 */
export function getTaskFilePath(
  taskId: string,
  subfolder: string,
  filename: string,
  baseOutputDir?: string
): string {
  return path.join(getTaskOutputPath(taskId, subfolder, baseOutputDir), filename);
}
