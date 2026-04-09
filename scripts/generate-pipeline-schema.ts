/**
 * Generate JSON Schema from the Zod pipeline config schema.
 * Usage: npx tsx scripts/generate-pipeline-schema.ts
 */

import { z } from 'zod';
import { pipelineConfigSchema } from '../src/pipeline/schema';
import fs from 'fs';
import path from 'path';

const jsonSchema = z.toJSONSchema(pipelineConfigSchema);

const outputPath = path.join(__dirname, '..', 'schemas', 'pipeline.schema.json');
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, JSON.stringify(jsonSchema, null, 2) + '\n');
console.log(`Schema written to ${outputPath}`);
