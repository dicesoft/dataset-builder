import '@mantine/core/styles.css';
import '@mantine/spotlight/styles.css';

import { lazy, Suspense, useEffect, useMemo } from 'react';
import { MantineProvider, DirectionProvider, createTheme, Loader, Center } from '@mantine/core';
import { useColorScheme } from '@mantine/hooks';
import { Spotlight, SpotlightActionData } from '@mantine/spotlight';
import { BrowserRouter, Routes, Route, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { RTL_LANGUAGES } from './i18n/config';
import { useUiStore } from './stores/uiStore';
import { useMetadataStore } from './stores/metadataStore';
import { AppShellLayout } from './components/Layout/AppShell';

const Dashboard = lazy(() => import('./pages/Dashboard'));
const Scrape = lazy(() => import('./pages/Scrape'));
const Generate = lazy(() => import('./pages/Generate'));
const Import = lazy(() => import('./pages/Import'));
const Transform = lazy(() => import('./pages/Transform'));
const Format = lazy(() => import('./pages/Format'));
const Clean = lazy(() => import('./pages/Clean'));
const Translate = lazy(() => import('./pages/Translate'));
const Compress = lazy(() => import('./pages/Compress'));
const Export = lazy(() => import('./pages/Export'));
const Pipeline = lazy(() => import('./pages/Pipeline'));
const DataBrowser = lazy(() => import('./pages/DataBrowser'));
const DataViewerPage = lazy(() => import('./pages/DataViewerPage'));
const WebSearch = lazy(() => import('./pages/WebSearch'));
const Prune = lazy(() => import('./pages/Prune'));
const Jobs = lazy(() => import('./pages/Jobs'));
const Settings = lazy(() => import('./pages/Settings'));

const theme = createTheme({
  primaryColor: 'blue',
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
});

function LoadingFallback() {
  return (
    <Center h="50vh">
      <Loader size="lg" />
    </Center>
  );
}

function resolveColorScheme(
  preference: 'light' | 'dark' | 'auto',
  systemScheme: 'light' | 'dark'
): 'light' | 'dark' {
  if (preference === 'auto') return systemScheme;
  return preference;
}

/** All navigable pages for the command palette / spotlight */
const spotlightPages = [
  {
    labelKey: 'spotlight.dashboard',
    path: '/',
    icon: '\ud83d\udcca',
    descKey: 'spotlight.dashboardDesc',
  },
  {
    labelKey: 'spotlight.scrape',
    path: '/scrape',
    icon: '\ud83d\udd77',
    descKey: 'spotlight.scrapeDesc',
  },
  {
    labelKey: 'spotlight.generate',
    path: '/generate',
    icon: '\ud83d\udd04',
    descKey: 'spotlight.generateDesc',
  },
  {
    labelKey: 'spotlight.import',
    path: '/import',
    icon: '\ud83d\udce5',
    descKey: 'spotlight.importDesc',
  },
  {
    labelKey: 'spotlight.transform',
    path: '/transform',
    icon: '\u2699',
    descKey: 'spotlight.transformDesc',
  },
  {
    labelKey: 'spotlight.format',
    path: '/format',
    icon: '\ud83d\udcdd',
    descKey: 'spotlight.formatDesc',
  },
  {
    labelKey: 'spotlight.clean',
    path: '/clean',
    icon: '\ud83e\uddf9',
    descKey: 'spotlight.cleanDesc',
  },
  {
    labelKey: 'spotlight.translate',
    path: '/translate',
    icon: '\ud83c\udf10',
    descKey: 'spotlight.translateDesc',
  },
  {
    labelKey: 'spotlight.compress',
    path: '/compress',
    icon: '\ud83d\udce6',
    descKey: 'spotlight.compressDesc',
  },
  {
    labelKey: 'spotlight.export',
    path: '/export',
    icon: '\ud83d\udce4',
    descKey: 'spotlight.exportDesc',
  },
  {
    labelKey: 'spotlight.webSearch',
    path: '/web-search',
    icon: '\ud83d\udd0d',
    descKey: 'spotlight.webSearchDesc',
  },
  { labelKey: 'spotlight.prune', path: '/prune', icon: '\u2702', descKey: 'spotlight.pruneDesc' },
  {
    labelKey: 'spotlight.pipeline',
    path: '/pipeline',
    icon: '\ud83d\udd17',
    descKey: 'spotlight.pipelineDesc',
  },
  {
    labelKey: 'spotlight.dataBrowser',
    path: '/data',
    icon: '\ud83d\udc41',
    descKey: 'spotlight.dataBrowserDesc',
  },
  { labelKey: 'spotlight.jobs', path: '/jobs', icon: '\u23f3', descKey: 'spotlight.jobsDesc' },
  {
    labelKey: 'spotlight.settings',
    path: '/settings',
    icon: '\u2699',
    descKey: 'spotlight.settingsDesc',
  },
];

/** Inner component with access to router hooks for Spotlight navigation */
function SpotlightNavigation() {
  const navigate = useNavigate();
  const { t } = useTranslation();

  const actions: SpotlightActionData[] = useMemo(
    () =>
      spotlightPages.map((page) => ({
        id: page.path,
        label: t(page.labelKey),
        description: t(page.descKey),
        leftSection: page.icon,
        onClick: () => navigate(page.path),
      })),
    [navigate, t]
  );

  return (
    <Spotlight
      actions={actions}
      shortcut={['mod + K']}
      nothingFound={t('common.noResults', 'No results found')}
      searchProps={{
        placeholder: t('common.searchPages', 'Search pages...'),
      }}
    />
  );
}

export function App() {
  const themePreference = useUiStore((s) => s.theme);
  const systemScheme = useColorScheme();
  const colorScheme = resolveColorScheme(themePreference, systemScheme);
  const { i18n } = useTranslation();

  const direction = RTL_LANGUAGES.includes(i18n.language) ? 'rtl' : 'ltr';

  useEffect(() => {
    document.documentElement.dir = direction;
    document.documentElement.lang = i18n.language;
  }, [direction, i18n.language]);

  useEffect(() => {
    useMetadataStore.getState().fetchAll();
  }, []);

  return (
    <DirectionProvider initialDirection={direction}>
      <MantineProvider
        theme={theme}
        defaultColorScheme={colorScheme}
        forceColorScheme={colorScheme}
      >
        <BrowserRouter>
          <SpotlightNavigation />
          <Suspense fallback={<LoadingFallback />}>
            <Routes>
              <Route element={<AppShellLayout />}>
                <Route index element={<Dashboard />} />
                <Route path="scrape" element={<Scrape />} />
                <Route path="generate" element={<Generate />} />
                <Route path="import" element={<Import />} />
                <Route path="transform" element={<Transform />} />
                <Route path="format" element={<Format />} />
                <Route path="clean" element={<Clean />} />
                <Route path="translate" element={<Translate />} />
                <Route path="compress" element={<Compress />} />
                <Route path="export" element={<Export />} />
                <Route path="web-search" element={<WebSearch />} />
                <Route path="prune" element={<Prune />} />
                <Route path="pipeline" element={<Pipeline />} />
                <Route path="data" element={<DataBrowser />} />
                <Route path="data/:path" element={<DataViewerPage />} />
                <Route path="jobs" element={<Jobs />} />
                <Route path="settings" element={<Settings />} />
                <Route path="*" element={<Dashboard />} />
              </Route>
            </Routes>
          </Suspense>
        </BrowserRouter>
      </MantineProvider>
    </DirectionProvider>
  );
}
