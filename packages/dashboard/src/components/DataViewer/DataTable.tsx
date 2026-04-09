/**
 * T050: DataTable component
 * Uses Mantine React Table (MRT) for data display with
 * sort, filter, search, pagination, row virtualization, and column visibility.
 */

import { useMemo } from 'react';
import {
  MantineReactTable,
  useMantineReactTable,
  type MRT_ColumnDef,
  type MRT_SortingState,
  type MRT_PaginationState,
} from 'mantine-react-table';

interface DataTableProps {
  records: Record<string, unknown>[];
  fields: string[];
  total: number;
  page: number;
  pageSize: number;
  onPageChange: (page: number, pageSize: number) => void;
  onSort?: (sort: string | undefined) => void;
  onFilter?: (filter: string | undefined) => void;
  onRowClick?: (record: Record<string, unknown>, index: number) => void;
}

function formatCellValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

export function DataTable({
  records,
  fields,
  total,
  page,
  pageSize,
  onPageChange,
  onSort,
  onRowClick,
}: DataTableProps) {
  const columns = useMemo<MRT_ColumnDef<Record<string, unknown>>[]>(
    () =>
      fields.map((field) => ({
        accessorKey: field,
        header: field,
        size: 150,
        minSize: 80,
        maxSize: 400,
        Cell: ({ cell }) => {
          const value = cell.getValue<unknown>();
          const display = formatCellValue(value);
          // Truncate long values
          if (display.length > 120) {
            return <span title={display}>{display.slice(0, 120)}...</span>;
          }
          return <span>{display}</span>;
        },
      })),
    [fields]
  );

  const pagination: MRT_PaginationState = {
    pageIndex: page - 1,
    pageSize,
  };

  const table = useMantineReactTable({
    columns,
    data: records,
    enableRowVirtualization: records.length > 100,
    enableColumnResizing: true,
    columnResizeMode: 'onChange',
    layoutMode: 'grid',
    enableColumnFilters: true,
    enableGlobalFilter: false,
    enableSorting: true,
    enableColumnActions: true,
    enableHiding: true,
    enableDensityToggle: true,
    enableFullScreenToggle: false,
    manualPagination: true,
    manualSorting: !!onSort,
    rowCount: total,
    state: {
      pagination,
    },
    onPaginationChange: (updater) => {
      const next = typeof updater === 'function' ? updater(pagination) : updater;
      onPageChange(next.pageIndex + 1, next.pageSize);
    },
    onSortingChange: (updater) => {
      if (!onSort) return;
      const sortingState: MRT_SortingState = typeof updater === 'function' ? updater([]) : updater;
      if (sortingState.length === 0) {
        onSort(undefined);
      } else {
        const { id, desc } = sortingState[0];
        onSort(desc ? `-${id}` : id);
      }
    },
    mantineTableBodyRowProps: ({ row }) => ({
      onClick: () => {
        if (onRowClick) {
          onRowClick(row.original, row.index + (page - 1) * pageSize);
        }
      },
      style: onRowClick ? { cursor: 'pointer' } : undefined,
    }),
    mantineTableContainerProps: {
      style: { maxHeight: '70vh', overflowX: 'auto' },
    },
  });

  return (
    <div style={{ overflowX: 'auto', maxWidth: '100%' }}>
      <MantineReactTable table={table} />
    </div>
  );
}
