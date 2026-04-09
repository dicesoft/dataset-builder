import fs from 'fs/promises';
import path from 'path';
import { safeJsonParse, safeJsonlParse } from '../utils/json';
import Papa from 'papaparse';
import { parse } from 'csv-parse/sync';
import xml2js from 'xml2js';
import * as XLSX from 'xlsx';
import * as cheerio from 'cheerio';

export interface ImportOptions {
  filePath: string;
  type?: string;
  encoding?: string;
  delimiter?: string;
}

export async function importFile(options: ImportOptions): Promise<unknown[]> {
  const { filePath, type, encoding = 'utf-8', delimiter = ',' } = options;

  const fileContent = await fs.readFile(filePath);
  const content = fileContent.toString(encoding as BufferEncoding);
  const ext = type === 'auto' ? path.extname(filePath).toLowerCase().slice(1) : type;

  switch (ext) {
    case 'csv':
      return importCSV(content, delimiter);
    case 'json':
      return importJSON(content);
    case 'jsonl':
      return importJSONL(content);
    case 'xml':
      return importXML(content);
    case 'xls':
    case 'xlsx':
      return importXLS(filePath);
    case 'txt':
      return importTXT(content);
    case 'html':
    case 'htm':
      return importHTML(content);
    default:
      throw new Error(`Unsupported file type: ${ext}`);
  }
}

function importCSV(content: string, delimiter: string): unknown[] {
  const records = parse(content, {
    delimiter,
    columns: true,
    skip_empty_lines: true,
    trim: true,
  });
  return records;
}

function importJSON(content: string): unknown[] {
  const data = safeJsonParse(content, 'import input file');
  return Array.isArray(data) ? data : [data];
}

function importJSONL(content: string): unknown[] {
  return safeJsonlParse(content, 'import input file');
}

async function importXML(content: string): Promise<unknown[]> {
  const result = await xml2js.parseStringPromise(content);
  return extractXMLData(result);
}

function extractXMLData(obj: unknown): unknown[] {
  if (Array.isArray(obj)) {
    return obj.flatMap(extractXMLData);
  }
  if (typeof obj === 'object' && obj !== null) {
    const entries = Object.entries(obj);
    for (const [, value] of entries) {
      if (Array.isArray(value) && value.length > 0) {
        if (typeof value[0] === 'object') {
          return value.map((item) => extractXMLData(item));
        }
        return value.map((v) => ({ value: v }));
      }
    }
    return [obj];
  }
  return [obj];
}

async function importXLS(filePath: string): Promise<unknown[]> {
  const workbook = XLSX.readFile(filePath);
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];
  return XLSX.utils.sheet_to_json(worksheet);
}

function importTXT(content: string): unknown[] {
  const lines = content.split('\n').filter((line) => line.trim());
  return lines.map((line, index) => ({ line: index + 1, text: line.trim() }));
}

function importHTML(content: string): unknown[] {
  const $ = cheerio.load(content);
  const data: Record<string, unknown>[] = [];

  // Extract links
  $('a').each((_, el) => {
    data.push({
      type: 'link',
      text: $(el).text().trim(),
      href: $(el).attr('href'),
    });
  });

  // Extract images
  $('img').each((_, el) => {
    data.push({
      type: 'image',
      src: $(el).attr('src'),
      alt: $(el).attr('alt'),
    });
  });

  // Extract headings
  $('h1, h2, h3, h4, h5, h6').each((_, el) => {
    const tag = $(el).prop('tagName') || '';
    data.push({
      type: 'heading',
      level: parseInt(tag.slice(1)),
      text: $(el).text().trim(),
    });
  });

  // Extract paragraphs
  $('p').each((_, el) => {
    const text = $(el).text().trim();
    if (text) {
      data.push({
        type: 'paragraph',
        text,
      });
    }
  });

  return data;
}
