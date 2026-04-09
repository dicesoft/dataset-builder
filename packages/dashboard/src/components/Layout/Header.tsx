import { Group, Burger, Title, ActionIcon, Select } from '@mantine/core';
import { useTranslation } from 'react-i18next';
import { useUiStore, type ThemePreference } from '@/stores/uiStore';
import { HealthBadge } from '@/components/HealthBadge/HealthBadge';
import { supportedLanguages } from '@/i18n/config';

const THEME_CYCLE: Record<ThemePreference, ThemePreference> = {
  auto: 'light',
  light: 'dark',
  dark: 'auto',
};

const THEME_ICON: Record<ThemePreference, string> = {
  light: '\u2600',
  dark: '\ud83c\udf19',
  auto: '\ud83d\udda5',
};

export function Header() {
  const { t, i18n } = useTranslation();
  const theme = useUiStore((s) => s.theme);
  const setTheme = useUiStore((s) => s.setTheme);
  const sidebarCollapsed = useUiStore((s) => s.sidebarCollapsed);
  const toggleSidebar = useUiStore((s) => s.toggleSidebar);
  const setLanguage = useUiStore((s) => s.setLanguage);

  const handleLanguageChange = (value: string | null) => {
    const lang = value ?? 'en';
    i18n.changeLanguage(lang);
    setLanguage(lang);
  };

  return (
    <Group h="100%" px="md" justify="space-between">
      <Group gap="sm">
        <Burger
          opened={!sidebarCollapsed}
          onClick={toggleSidebar}
          hiddenFrom="sm"
          size="sm"
          aria-label={t('header.toggleNav')}
        />
        <Title order={3}>{t('common.appName')}</Title>
      </Group>

      <Group gap="sm">
        <HealthBadge />

        <Select
          value={i18n.language}
          onChange={handleLanguageChange}
          data={supportedLanguages.map((l) => ({ value: l.value, label: l.label }))}
          size="xs"
          w={140}
          searchable
          allowDeselect={false}
          aria-label="Select language"
        />

        <ActionIcon
          variant="default"
          size="lg"
          onClick={() => setTheme(THEME_CYCLE[theme])}
          aria-label={t('header.toggleTheme')}
        >
          {THEME_ICON[theme]}
        </ActionIcon>
      </Group>
    </Group>
  );
}
