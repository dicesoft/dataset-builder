import { useRef, useEffect, useState } from 'react';
import { Alert, AppShell as MantineAppShell, Box } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { Outlet, useLocation } from 'react-router-dom';
import { useUiStore } from '@/stores/uiStore';
import { useJobStore, getErrorMessage } from '@/stores/jobStore';
import { useWebSocket } from '@/hooks/useWebSocket';
import { Sidebar, BottomNav } from './Sidebar';
import { Header } from './Header';
import { JobMonitor } from '@/components/JobMonitor/JobMonitor';

const srOnlyStyles: React.CSSProperties = {
  position: 'absolute',
  width: '1px',
  height: '1px',
  padding: 0,
  margin: '-1px',
  overflow: 'hidden',
  clip: 'rect(0, 0, 0, 0)',
  whiteSpace: 'nowrap',
  border: 0,
};

const skipLinkStyles: React.CSSProperties = {
  position: 'absolute',
  left: '-9999px',
  top: 'auto',
  width: '1px',
  height: '1px',
  overflow: 'hidden',
  zIndex: 1000,
};

const skipLinkFocusStyles = `
  .skip-to-content:focus {
    position: fixed !important;
    top: 8px;
    left: 8px;
    width: auto !important;
    height: auto !important;
    padding: 8px 16px;
    background: var(--mantine-color-blue-6);
    color: white;
    font-weight: 600;
    border-radius: 4px;
    z-index: 10000 !important;
    overflow: visible !important;
    text-decoration: none;
  }
`;

export function AppShellLayout() {
  const sidebarCollapsed = useUiStore((s) => s.sidebarCollapsed);
  const isMobile = useMediaQuery('(max-width: 768px)');
  const mainRef = useRef<HTMLDivElement>(null);
  const location = useLocation();
  const [ariaMessage, setAriaMessage] = useState('');
  const wsStatus = useWebSocket();

  // Announce job status changes to screen readers
  const jobs = useJobStore((s) => s.jobs);
  const prevJobsRef = useRef<Map<string, string>>(new Map());
  useEffect(() => {
    const prevStatuses = prevJobsRef.current;
    for (const [id, job] of jobs) {
      const prev = prevStatuses.get(id);
      if (prev && prev !== job.status) {
        if (job.status === 'completed') {
          setAriaMessage(`Job ${job.command} completed successfully`);
        } else if (job.status === 'failed') {
          setAriaMessage(`Job ${job.command} failed: ${getErrorMessage(job.error)}`);
        }
      }
    }
    const next = new Map<string, string>();
    for (const [id, job] of jobs) {
      next.set(id, job.status);
    }
    prevJobsRef.current = next;
  }, [jobs]);

  // Focus management on route changes
  useEffect(() => {
    mainRef.current?.focus({ preventScroll: false });
  }, [location.pathname]);

  return (
    <MantineAppShell
      header={{ height: 60 }}
      navbar={{
        width: 260,
        breakpoint: 'sm',
        collapsed: { mobile: sidebarCollapsed },
      }}
      padding="md"
    >
      <style>{skipLinkFocusStyles}</style>
      <a className="skip-to-content" href="#main-content" style={skipLinkStyles}>
        Skip to content
      </a>

      {/* Visually hidden aria-live region for screen reader announcements */}
      <div aria-live="polite" aria-atomic="true" style={srOnlyStyles}>
        {ariaMessage}
      </div>

      <MantineAppShell.Header>
        <Header />
      </MantineAppShell.Header>

      <MantineAppShell.Navbar>
        <Sidebar />
      </MantineAppShell.Navbar>

      <MantineAppShell.Main>
        {wsStatus === 'disconnected' && (
          <Alert color="red" variant="light" mb="sm">
            Connection lost. Attempting to reconnect...
          </Alert>
        )}
        {wsStatus === 'reconnecting' && (
          <Alert color="yellow" variant="light" mb="sm">
            Reconnecting to server...
          </Alert>
        )}
        {/* Add bottom padding on mobile to avoid content hidden behind bottom nav */}
        <Box
          id="main-content"
          ref={mainRef}
          tabIndex={-1}
          pb={isMobile ? 64 : 0}
          style={{ outline: 'none' }}
        >
          <Outlet />
        </Box>
      </MantineAppShell.Main>

      {isMobile && <BottomNav />}
      <JobMonitor />
    </MantineAppShell>
  );
}
