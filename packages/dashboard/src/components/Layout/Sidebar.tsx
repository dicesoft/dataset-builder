import { NavLink, Stack, Text, UnstyledButton, Group, Box } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useUiStore } from '@/stores/uiStore';

interface NavItem {
  labelKey: string;
  path: string;
  icon: string;
}

interface NavGroup {
  groupKey: string;
  items: NavItem[];
}

const navGroups: NavGroup[] = [
  {
    groupKey: '',
    items: [
      { labelKey: 'sidebar.dashboard', path: '/', icon: '\ud83d\udcca' },
      { labelKey: 'sidebar.datasets', path: '/data', icon: '\ud83d\uddc2' },
      { labelKey: 'sidebar.jobs', path: '/jobs', icon: '\u23f3' },
    ],
  },
  {
    groupKey: 'sidebar.dataCollection',
    items: [
      { labelKey: 'sidebar.scrape', path: '/scrape', icon: '\ud83d\udd77' },
      { labelKey: 'sidebar.generate', path: '/generate', icon: '\ud83d\udd04' },
      { labelKey: 'sidebar.import', path: '/import', icon: '\ud83d\udce5' },
    ],
  },
  {
    groupKey: 'sidebar.processing',
    items: [
      { labelKey: 'sidebar.transform', path: '/transform', icon: '\u2699' },
      { labelKey: 'sidebar.format', path: '/format', icon: '\ud83d\udcdd' },
      { labelKey: 'sidebar.clean', path: '/clean', icon: '\ud83e\uddf9' },
    ],
  },
  {
    groupKey: 'sidebar.output',
    items: [
      { labelKey: 'sidebar.translate', path: '/translate', icon: '\ud83c\udf10' },
      { labelKey: 'sidebar.compress', path: '/compress', icon: '\ud83d\udce6' },
      { labelKey: 'sidebar.export', path: '/export', icon: '\ud83d\udce4' },
    ],
  },
  {
    groupKey: 'sidebar.tools',
    items: [
      { labelKey: 'sidebar.webSearch', path: '/web-search', icon: '\ud83d\udd0d' },
      { labelKey: 'sidebar.prune', path: '/prune', icon: '\u2702' },
      { labelKey: 'sidebar.pipeline', path: '/pipeline', icon: '\ud83d\udd17' },
      { labelKey: 'sidebar.settings', path: '/settings', icon: '\u2699' },
    ],
  },
];

const BOTTOM_NAV_ITEMS: NavItem[] = [
  { labelKey: 'sidebar.dashboard', path: '/', icon: '\ud83d\udcca' },
  { labelKey: 'sidebar.scrape', path: '/scrape', icon: '\ud83d\udd77' },
  { labelKey: 'sidebar.datasets', path: '/data', icon: '\ud83d\uddc2' },
  { labelKey: 'sidebar.jobs', path: '/jobs', icon: '\u23f3' },
  { labelKey: 'sidebar.settings', path: '/settings', icon: '\u2699' },
];

const bottomNavFocusStyles = `
  .bottom-nav-btn:focus-visible {
    outline: 2px solid var(--mantine-primary-color-filled);
    outline-offset: -2px;
    border-radius: 4px;
  }
`;

export function BottomNav() {
  const { t } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();

  return (
    <>
      <style>{bottomNavFocusStyles}</style>
      <Box
        component="nav"
        aria-label="Mobile navigation"
        style={{
          position: 'fixed',
          bottom: 0,
          left: 0,
          right: 0,
          zIndex: 200,
          borderTop: '1px solid var(--mantine-color-default-border)',
          backgroundColor: 'var(--mantine-color-body)',
          display: 'flex',
          justifyContent: 'space-around',
          alignItems: 'center',
          height: 56,
          paddingBottom: 'env(safe-area-inset-bottom, 0px)',
        }}
      >
        {BOTTOM_NAV_ITEMS.map((item) => {
          const isActive =
            item.path === '/' ? location.pathname === '/' : location.pathname.startsWith(item.path);
          return (
            <UnstyledButton
              key={item.path}
              className="bottom-nav-btn"
              onClick={() => navigate(item.path)}
              aria-label={t(item.labelKey)}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 2,
                flex: 1,
                paddingTop: 6,
                paddingBottom: 6,
                color: isActive ? 'var(--mantine-color-blue-6)' : 'var(--mantine-color-dimmed)',
              }}
            >
              <Text size="lg" lh={1}>
                {item.icon}
              </Text>
              <Text size="xs" fw={isActive ? 600 : 400} lh={1}>
                {t(item.labelKey)}
              </Text>
            </UnstyledButton>
          );
        })}
      </Box>
    </>
  );
}

export function Sidebar() {
  const { t } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const collapsed = useUiStore((s) => s.sidebarCollapsed);
  const toggleSidebar = useUiStore((s) => s.toggleSidebar);
  const isMobile = useMediaQuery('(max-width: 768px)');

  const handleClick = (path: string) => {
    navigate(path);
    // On mobile / tablet with open drawer, close sidebar after navigation
    if (isMobile && !collapsed) {
      toggleSidebar();
    }
  };

  return (
    <nav aria-label={t('sidebar.dashboard')}>
      <Stack gap={0} py="xs">
        {navGroups.map((group) => (
          <div
            key={group.groupKey || '__root'}
            role="group"
            aria-label={group.groupKey ? t(group.groupKey) : undefined}
          >
            {group.groupKey && (
              <Text size="xs" fw={700} c="dimmed" tt="uppercase" px="md" pt="md" pb={4}>
                {t(group.groupKey)}
              </Text>
            )}

            {group.items.map((item) => (
              <NavLink
                key={item.path}
                label={t(item.labelKey)}
                aria-label={t(item.labelKey)}
                leftSection={
                  <Text component="span" size="sm">
                    {item.icon}
                  </Text>
                }
                active={
                  item.path === '/'
                    ? location.pathname === '/'
                    : location.pathname.startsWith(item.path)
                }
                onClick={() => handleClick(item.path)}
                variant="light"
              />
            ))}
          </div>
        ))}
      </Stack>
    </nav>
  );
}
