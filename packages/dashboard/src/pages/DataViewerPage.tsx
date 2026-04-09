/**
 * DataViewerPage — thin wrapper that renders the DataViewer container.
 * This page is mounted at /data/:path.
 */

import { DataViewer } from '@/components/DataViewer/DataViewer';

export default function DataViewerPage() {
  return <DataViewer />;
}
