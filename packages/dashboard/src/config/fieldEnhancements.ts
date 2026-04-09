/**
 * Static map of field enhancements for FormBuilder.
 *
 * Keyed by `commandName.optionName`, each entry describes how the field
 * should be rendered beyond what Commander.js metadata provides.
 */

export interface FieldEnhancement {
  /** Render MultiSelect instead of Select (for multi-value selection with choices) */
  multi?: boolean;
  /** Render TagsInput for free-form multi-value entry */
  tags?: boolean;
  /** Render Checkbox.Group instead of MultiSelect */
  checkboxGroup?: boolean;
  /** Show availability status on options (e.g., provider API key availability) */
  showAvailability?: boolean;
  /** Min value for NumberInput */
  min?: number;
  /** Max value for NumberInput */
  max?: number;
  /** Data source key — fetches options from metadataStore */
  dataSource?:
    | 'models'
    | 'datasets'
    | 'languages'
    | 'formats'
    | 'templates'
    | 'providers'
    | 'enums';
}

export const FIELD_ENHANCEMENTS: Record<string, FieldEnhancement> = {
  // Scrape command
  'scrape.searchProvider': { multi: true, dataSource: 'providers', showAvailability: true },
  'scrape.formats': { checkboxGroup: true, dataSource: 'enums' },

  // Generate command
  'generate.model': { dataSource: 'models' },

  // Transform command
  'transform.model': { dataSource: 'models' },
  'transform.labels': { tags: true },

  // Translate command
  'translate.model': { dataSource: 'models' },
  'translate.languages': { multi: true, dataSource: 'languages' },

  // Clean command
  'clean.targetFields': { tags: true },

  // Compress command
  'compress.crf': { min: 0, max: 51 },

  // Format command
  'format.requiredFields': { tags: true },
  'format.fieldMap': { tags: true },
};
