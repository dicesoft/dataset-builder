import {
  Button,
  Checkbox,
  Fieldset,
  Group,
  MultiSelect,
  NumberInput,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  TagsInput,
  Text,
  TextInput,
  Textarea,
  Tooltip,
  type ComboboxItem,
} from '@mantine/core';
import { useForm } from '@mantine/form';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { FIELD_ENHANCEMENTS, type FieldEnhancement } from '../../config/fieldEnhancements';
import { useMetadataStore } from '../../stores/metadataStore';
import type { ProviderInfo } from '../../types/metadata';

export interface CommandOption {
  name: string;
  flag?: string;
  flags?: string;
  type: 'string' | 'number' | 'boolean' | 'unknown';
  description: string;
  required?: boolean;
  default?: unknown;
  defaultValue?: unknown;
  enum?: string[];
  choices?: string[] | null;
}

export interface FieldGroup {
  label: string;
  fields: string[];
}

export interface FormBuilderProps {
  commandName: string;
  options: CommandOption[];
  groups?: FieldGroup[];
  onSubmit: (values: Record<string, unknown>) => void;
  loading?: boolean;
  initialValues?: Record<string, unknown>;
  /** Called when any form value changes — useful for progressive disclosure */
  onValuesChange?: (values: Record<string, unknown>) => void;
  /** When false, the Submit button is rendered disabled. Defaults to true.
   *  Composes with FormBuilder's internal form-validity state: the button
   *  is disabled if EITHER canSubmit === false OR the form itself is invalid. */
  canSubmit?: boolean;
}

/** Field names that should render as Textarea instead of TextInput */
const LONG_TEXT_FIELDS = new Set(['prompt', 'schema', 'description', 'template', 'systemPrompt']);

function isLongTextField(name: string): boolean {
  return (
    LONG_TEXT_FIELDS.has(name) ||
    name.toLowerCase().includes('prompt') ||
    name.toLowerCase().includes('schema')
  );
}

/** Look up the enhancement for a given command + option name */
export function getEnhancement(
  commandName: string,
  optionName: string
): FieldEnhancement | undefined {
  return FIELD_ENHANCEMENTS[`${commandName}.${optionName}`];
}

/**
 * Parse a value into an array for multi/tags fields.
 * Handles: string with commas -> split, existing array -> pass through, falsy -> [].
 */
function toArrayValue(value: unknown): string[] {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string' && value.length > 0) return value.split(',').map((s) => s.trim());
  return [];
}

export function buildInitialValues(
  options: CommandOption[],
  commandName: string,
  initialValues?: Record<string, unknown>
): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const opt of options) {
    const enhancement = getEnhancement(commandName, opt.name);
    const def = opt.default ?? opt.defaultValue ?? null;
    const raw = initialValues?.[opt.name] ?? def;

    if (enhancement?.multi || enhancement?.tags || enhancement?.checkboxGroup) {
      // Array fields: parse comma-separated strings into arrays for backward compat
      values[opt.name] = toArrayValue(raw);
    } else if (opt.type === 'boolean') {
      values[opt.name] = raw ?? false;
    } else if (opt.type === 'number') {
      values[opt.name] = raw ?? '';
    } else {
      values[opt.name] = raw ?? '';
    }
  }
  return values;
}

function buildValidation(options: CommandOption[]) {
  const validate: Record<string, (value: unknown) => string | null> = {};
  for (const opt of options) {
    if (opt.required) {
      validate[opt.name] = (value: unknown) => {
        if (value === null || value === undefined || value === '') {
          return `${opt.name} is required`;
        }
        return null;
      };
    }
  }
  return validate;
}

/** Resolve data source options from metadataStore for a given enhancement */
function useDataSourceOptions(enhancement: FieldEnhancement | undefined): string[] {
  const models = useMetadataStore((s) => s.models);
  const providers = useMetadataStore((s) => s.providers);
  const languages = useMetadataStore((s) => s.languages);
  const enums = useMetadataStore((s) => s.enums);

  return useMemo(() => {
    if (!enhancement?.dataSource) return [];
    switch (enhancement.dataSource) {
      case 'models':
        return models.map((m) => m.name);
      case 'providers':
        return providers.map((p) => p.name);
      case 'languages':
        return languages.map((l) => l.code);
      case 'enums':
        return enums?.downloadFormats ?? [];
      default:
        return [];
    }
  }, [enhancement?.dataSource, models, providers, languages, enums]);
}

/** Build MultiSelect data with availability info for providers */
function useProviderSelectData(enhancement: FieldEnhancement | undefined): ComboboxItem[] {
  const providers = useMetadataStore((s) => s.providers);

  return useMemo(() => {
    if (!enhancement?.showAvailability || enhancement.dataSource !== 'providers') return [];
    // Sort: available first, then unavailable
    const sorted = [...providers].sort((a, b) => {
      if (a.available === b.available) return a.name.localeCompare(b.name);
      return a.available ? -1 : 1;
    });
    return sorted.map((p) => ({
      value: p.name,
      label: p.name,
      disabled: !p.available,
    }));
  }, [enhancement?.showAvailability, enhancement?.dataSource, providers]);
}

/** Get provider info map for tooltip rendering */
function useProviderInfoMap(enhancement: FieldEnhancement | undefined): Map<string, ProviderInfo> {
  const providers = useMetadataStore((s) => s.providers);

  return useMemo(() => {
    if (!enhancement?.showAvailability) return new Map();
    return new Map(providers.map((p) => [p.name, p]));
  }, [enhancement?.showAvailability, providers]);
}

function RenderField({
  opt,
  form,
  commandName,
}: {
  opt: CommandOption;
  form: ReturnType<typeof useForm>;
  commandName: string;
}) {
  const enhancement = getEnhancement(commandName, opt.name);
  const dataSourceOptions = useDataSourceOptions(enhancement);
  const providerSelectData = useProviderSelectData(enhancement);
  const providerInfoMap = useProviderInfoMap(enhancement);
  const choices = opt.enum ?? opt.choices;
  const key = opt.name;
  const inputProps = form.getInputProps(key);
  const description = opt.description;

  if (opt.type === 'boolean') {
    return (
      <Switch
        key={key}
        label={opt.name}
        description={description}
        aria-label={opt.name}
        {...inputProps}
        checked={!!inputProps.value}
      />
    );
  }

  if (opt.type === 'number') {
    return (
      <NumberInput
        key={key}
        label={opt.name}
        description={description}
        placeholder={opt.defaultValue != null ? String(opt.defaultValue) : undefined}
        allowDecimal={false}
        withAsterisk={opt.required}
        min={enhancement?.min}
        max={enhancement?.max}
        {...inputProps}
        value={inputProps.value === '' ? '' : Number(inputProps.value)}
      />
    );
  }

  // Checkbox.Group for multi-value selection displayed as checkboxes
  if (enhancement?.checkboxGroup) {
    const items = dataSourceOptions.length > 0 ? dataSourceOptions : (choices ?? []);
    return (
      <Checkbox.Group
        key={key}
        label={opt.name}
        description={description}
        withAsterisk={opt.required}
        {...inputProps}
        value={Array.isArray(inputProps.value) ? inputProps.value : []}
      >
        <SimpleGrid cols={{ base: 2, sm: 3, md: 4 }} mt="xs">
          {items.map((item) => (
            <Checkbox key={item} value={item} label={item} />
          ))}
        </SimpleGrid>
      </Checkbox.Group>
    );
  }

  // TagsInput for free-form multi-value entry
  if (enhancement?.tags) {
    return (
      <TagsInput
        key={key}
        label={opt.name}
        description={description}
        placeholder={`Enter ${opt.name} values`}
        withAsterisk={opt.required}
        {...inputProps}
        value={Array.isArray(inputProps.value) ? inputProps.value : []}
      />
    );
  }

  // MultiSelect with provider availability rendering
  if (enhancement?.multi && enhancement.showAvailability && providerSelectData.length > 0) {
    return (
      <MultiSelect
        key={key}
        label={opt.name}
        description={description}
        data={providerSelectData}
        searchable
        clearable
        placeholder={`Select ${opt.name}`}
        withAsterisk={opt.required}
        renderOption={({ option }) => {
          const info = providerInfoMap.get(option.value);
          if (info && !info.available && info.requiresKey) {
            return (
              <Tooltip label={`Requires API key: ${info.requiresKey}`} position="right" withArrow>
                <Group gap="xs" w="100%">
                  <Text size="sm" c="dimmed">
                    {option.label}
                  </Text>
                  <Text size="xs" c="red" ml="auto">
                    unavailable
                  </Text>
                </Group>
              </Tooltip>
            );
          }
          return <Text size="sm">{option.label}</Text>;
        }}
        {...inputProps}
        value={Array.isArray(inputProps.value) ? inputProps.value : []}
      />
    );
  }

  // MultiSelect: field has multi enhancement with data source or choices
  if (enhancement?.multi) {
    const data =
      dataSourceOptions.length > 0
        ? dataSourceOptions.map((v) => ({ value: v, label: v }))
        : choices
          ? choices.map((c) => ({ value: c, label: c }))
          : [];
    return (
      <MultiSelect
        key={key}
        label={opt.name}
        description={description}
        data={data}
        searchable
        clearable
        placeholder={`Select ${opt.name}`}
        withAsterisk={opt.required}
        {...inputProps}
        value={Array.isArray(inputProps.value) ? inputProps.value : []}
      />
    );
  }

  // Model select or other data-source-backed single Select
  if (enhancement?.dataSource && dataSourceOptions.length > 0) {
    const data = dataSourceOptions.map((v) => ({ value: v, label: v }));
    return (
      <Select
        key={key}
        label={opt.name}
        description={description}
        data={data}
        clearable
        searchable
        placeholder={`Select ${opt.name}`}
        withAsterisk={opt.required}
        {...inputProps}
        value={inputProps.value != null ? String(inputProps.value) : null}
      />
    );
  }

  // String type with enum/choices -> Select
  if (choices && choices.length > 0) {
    const data = choices.map((c) => ({ value: c, label: c }));
    return (
      <Select
        key={key}
        label={opt.name}
        description={description}
        data={data}
        clearable
        searchable
        placeholder={`Select ${opt.name}`}
        withAsterisk={opt.required}
        {...inputProps}
        value={inputProps.value != null ? String(inputProps.value) : null}
      />
    );
  }

  // String type that suggests long text -> Textarea
  if (isLongTextField(opt.name)) {
    return (
      <Textarea
        key={key}
        label={opt.name}
        description={description}
        placeholder={opt.defaultValue != null ? String(opt.defaultValue) : undefined}
        autosize
        minRows={3}
        maxRows={8}
        withAsterisk={opt.required}
        {...inputProps}
        value={inputProps.value != null ? String(inputProps.value) : ''}
      />
    );
  }

  // Default: TextInput
  return (
    <TextInput
      key={key}
      label={opt.name}
      description={description}
      placeholder={opt.defaultValue != null ? String(opt.defaultValue) : undefined}
      withAsterisk={opt.required}
      {...inputProps}
      value={inputProps.value != null ? String(inputProps.value) : ''}
    />
  );
}

/**
 * Serialize form values for API submission.
 * Joins array values to comma-separated strings for multi/tags fields.
 * Strips empty/null values.
 */
export function serializeFormValues(
  values: Record<string, unknown>,
  commandName: string
): Record<string, unknown> {
  const cleaned: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(values)) {
    const enhancement = getEnhancement(commandName, k);
    if (Array.isArray(v)) {
      // Array fields (multi/tags): join to CSV if non-empty, skip if empty
      if (v.length > 0) {
        cleaned[k] =
          enhancement?.multi || enhancement?.tags || enhancement?.checkboxGroup ? v.join(',') : v;
      }
    } else if (v !== '' && v !== null && v !== undefined) {
      cleaned[k] = v;
    }
  }
  return cleaned;
}

export function FormBuilder({
  commandName,
  options,
  groups,
  onSubmit,
  loading,
  initialValues,
  onValuesChange,
  canSubmit = true,
}: FormBuilderProps) {
  const { t } = useTranslation();
  const computedInitialValues = useMemo(
    () => buildInitialValues(options, commandName, initialValues),
    [options, commandName, initialValues]
  );
  const form = useForm({
    initialValues: computedInitialValues,
    validate: buildValidation(options),
    onValuesChange: onValuesChange,
  });

  // Build a lookup: field name -> option
  const optionMap = useMemo(() => {
    const m = new Map<string, CommandOption>();
    for (const o of options) m.set(o.name, o);
    return m;
  }, [options]);

  const handleSubmit = (values: Record<string, unknown>) => {
    onSubmit(serializeFormValues(values, commandName));
  };

  const handleReset = () => {
    form.setValues(buildInitialValues(options, commandName, initialValues));
  };

  // Determine which fields are grouped vs ungrouped
  const groupedFieldNames = useMemo(() => {
    if (!groups) return new Set<string>();
    return new Set(groups.flatMap((g) => g.fields));
  }, [groups]);

  const ungroupedOptions = useMemo(
    () => options.filter((o) => !groupedFieldNames.has(o.name)),
    [options, groupedFieldNames]
  );

  return (
    <form onSubmit={form.onSubmit(handleSubmit)} aria-label={`${commandName} configuration form`}>
      <Stack gap="md">
        {groups?.map((group) => {
          const groupOptions = group.fields
            .map((f) => optionMap.get(f))
            .filter(Boolean) as CommandOption[];
          if (groupOptions.length === 0) return null;
          return (
            <Fieldset key={group.label} legend={group.label}>
              <Stack gap="sm">
                {groupOptions.map((opt) => (
                  <RenderField key={opt.name} opt={opt} form={form} commandName={commandName} />
                ))}
              </Stack>
            </Fieldset>
          );
        })}

        {ungroupedOptions.length > 0 && (
          <Fieldset legend={groups ? t('common.otherOptions') : commandName}>
            <Stack gap="sm">
              {ungroupedOptions.map((opt) => (
                <RenderField key={opt.name} opt={opt} form={form} commandName={commandName} />
              ))}
            </Stack>
          </Fieldset>
        )}

        <Group justify="flex-end">
          <Button type="button" variant="default" onClick={handleReset}>
            {t('common.reset')}
          </Button>
          <Button type="submit" loading={loading} disabled={!canSubmit || !form.isValid()}>
            {t('common.submit')}
          </Button>
        </Group>
      </Stack>
    </form>
  );
}
