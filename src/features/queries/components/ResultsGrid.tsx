import {
	type Cell,
	createColumnHelper,
	flexRender,
	getCoreRowModel,
	type RowSelectionState,
	useReactTable,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
	type PointerEvent,
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { useTranslation } from "react-i18next";

import type { ColumnProperties, QueryResult, TableInfo } from "@/data/types";
import { ResultEditInput, InsertRowInput } from "@/features/queries/components/ResultsCellEditor";
import { ResultsToolbar } from "@/features/queries/components/ResultsToolbar";
import { useInsertRowMutation } from "@/features/queries/queries";
import {
	type InsertRowColumnValue,
	isInsertFormColumn,
	type ResultEditPatch,
	type ResultRow,
} from "@/features/queries/result-edits";
import {
	copyRows,
	downloadRowsAsCsv,
	downloadRowsAsJson,
} from "@/features/queries/results-export";
import { useTablePropertiesQuery } from "@/features/schema/queries";
import { notifyError } from "@/lib/error-notifier";
import { useSettings } from "@/lib/settings";

const SELECT_COLUMN_WIDTH_PX = 44;
const DEFAULT_DATA_COLUMN_WIDTH_PX = 180;
const MIN_COLUMN_WIDTH_PX = 48;
const MAX_COLUMN_WIDTH_PX = 640;

type ResultsGridProps = {
	result: QueryResult | null;
	isPending?: boolean;
	isSaving?: boolean;
	canEdit?: boolean;
	editableColumns?: string[];
	primaryKeyColumns?: string[];
	saveDisabledReason?: string;
	onRefresh?: () => void;
	onSaveEdits?: (patches: ResultEditPatch[]) => Promise<void>;
	/** Requests inline insert row (shell increments trigger). */
	onAddRow?: () => void;
	insertRowTrigger?: number;
	insertConnectionId?: string | null;
	insertTable?: TableInfo | null;
	canInsertRow?: boolean;
	onInsertRowSuccess?: () => void;
	onDeleteRows?: (primaryKeys: Record<string, string | null>[]) => Promise<void>;
};

function formatValue(value: string | null | undefined) {
	if (value === null) {
		return "NULL";
	}

	if (value === undefined || value === "") {
		return "";
	}

	return value;
}

function toEditableValue(value: string | null | undefined) {
	return value ?? "";
}

function normalizeColumnId(columnId: string) {
	return columnId.toLowerCase();
}

function renderLoadingSkeleton() {
	const dataColumnCount = 4;
	const placeholderRows = 10;
	const skeletonTemplateColumns = [
		`${SELECT_COLUMN_WIDTH_PX}px`,
		...Array.from(
			{ length: dataColumnCount },
			() => `${DEFAULT_DATA_COLUMN_WIDTH_PX}px`,
		),
	].join(" ");
	const columnIndices = Array.from(
		{ length: 1 + dataColumnCount },
		(_, index) => index,
	);
	const rowKeys = Array.from(
		{ length: placeholderRows },
		(_, index) => `skeleton-row-${index}`,
	);

	const toolbarColumns = [
		{ id: "__select", label: "Select", visible: true, canHide: false },
		...Array.from({ length: dataColumnCount }, (_, index) => ({
			id: `__skeleton_col_${index}`,
			label: `Column ${index + 1}`,
			visible: true,
			canHide: true,
		})),
	];

	return (
		<div className="flex h-full min-w-0 flex-col overflow-hidden">
			<ResultsToolbar
				columns={toolbarColumns}
				canEdit={false}
				isDirty={false}
				isBusy
				onToggleColumn={() => {}}
				onRefresh={() => {}}
				onCopy={() => {}}
				onDownloadCsv={() => {}}
				onDownloadJson={() => {}}
				onSave={() => {}}
				onAddRow={undefined}
			/>
			<div className="min-h-0 min-w-0 flex-1 overflow-x-auto">
				<div className="flex h-full w-max min-w-full flex-col">
					<div
						className="sticky top-0 z-10 grid w-max min-w-full shrink-0 border-b border-border bg-muted/30"
						style={{ gridTemplateColumns: skeletonTemplateColumns }}
					>
						{columnIndices.map((columnIndex) => (
							<div
								key={`sk-h-${columnIndex}`}
								className="relative min-w-0 truncate border-r border-border px-3 py-2 pr-2 last:border-r-0"
							>
								<div
									className={`h-3 animate-pulse rounded-sm bg-muted ${columnIndex === 0 ? "w-10" : "w-24 max-w-full"}`}
								/>
							</div>
						))}
					</div>
					<div className="min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden">
						<div className="w-max min-w-full">
							{rowKeys.map((rowKey) => (
								<div
									key={rowKey}
									className="grid w-max min-w-full border-b border-border/60 bg-background text-xs"
									style={{
										gridTemplateColumns: skeletonTemplateColumns,
										height: 36,
									}}
								>
									{columnIndices.map((columnIndex) => (
										<div
											key={`${rowKey}-c${columnIndex}`}
											className="flex min-w-0 items-center border-r border-border/60 px-3 py-2 last:border-r-0"
										>
											<div className="h-3.5 w-full max-w-[85%] animate-pulse rounded-sm bg-muted/80" />
										</div>
									))}
								</div>
							))}
						</div>
					</div>
				</div>
			</div>
			<div className="border-t border-border bg-muted/10 px-3 py-1.5 text-[11px] text-muted-foreground">
				<span
					className="inline-block h-3 w-40 animate-pulse rounded-sm bg-muted/60"
					aria-hidden
				/>
			</div>
		</div>
	);
}

export function ResultsGrid({
	result,
	isPending = false,
	isSaving = false,
	canEdit = false,
	editableColumns = [],
	primaryKeyColumns = [],
	saveDisabledReason,
	onRefresh,
	onSaveEdits,
	onAddRow,
	insertRowTrigger = 0,
	insertConnectionId = null,
	insertTable = null,
	canInsertRow = false,
	onInsertRowSuccess = () => {},
	onDeleteRows,
}: ResultsGridProps) {
	const { t } = useTranslation()
	const parentRef = useRef<HTMLDivElement | null>(null);
	const horizontalScrollRef = useRef<HTMLDivElement | null>(null);
	const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
	const [columnVisibility, setColumnVisibility] = useState<
		Record<string, boolean>
	>({});
	const [columnWidths, setColumnWidths] = useState<Record<string, number>>({});
	const [pendingEdits, setPendingEdits] = useState<
		Record<string, Record<string, string | null>>
	>({});
	const [editingCell, setEditingCell] = useState<{
		rowId: string;
		columnId: string;
	} | null>(null);
	const [gridError, setGridError] = useState<string | null>(null);
	const [showInsertRow, setShowInsertRow] = useState(false);
	const [insertDraft, setInsertDraft] = useState<Record<string, string>>({});
	const [deleteBusy, setDeleteBusy] = useState(false);
	const lastInsertRowTriggerRef = useRef(insertRowTrigger);
	const resizeRafRef = useRef<number | null>(null);
	const pendingResizeWidthsRef = useRef<Record<string, number>>({});
	const [copiedCellId, setCopiedCellId] = useState<string | null>(null);
	const copyTimeoutRef = useRef<number | null>(null);
	const clickToCopy = useSettings((s) => s.clickToCopy)

	const insertMutation = useInsertRowMutation({
		onError: (error) => {
			notifyError(error, {
				category: "query",
				title: t("editor.insertFailed"),
			});
		},
	});

	const columns = useMemo(() => result?.columns ?? [], [result?.columns]);
	const columnsFingerprint = columns.join("\u0001");
	const queryResultEditResetKey =
		result != null
			? `${result.executionMs}\u0000${result.rowCount}\u0000${columnsFingerprint}`
			: "";
	const resultColumnByLower = useMemo(
		() =>
			new Map(
				columns.map((columnName) => [normalizeColumnId(columnName), columnName]),
			),
		[columns],
	);
	const editableColumnsByLower = useMemo(
		() =>
			new Map(
				editableColumns.map((columnName) => [
					normalizeColumnId(columnName),
					columnName,
				]),
			),
		[editableColumns],
	);
	const primaryKeyColumnsByLower = useMemo(
		() => new Set(primaryKeyColumns.map((columnName) => normalizeColumnId(columnName))),
		[primaryKeyColumns],
	);

	const propertiesQuery = useTablePropertiesQuery({
		connectionId: insertConnectionId ?? undefined,
		table: insertTable,
		enabled: Boolean(
			showInsertRow &&
				canInsertRow &&
				insertConnectionId &&
				insertTable &&
				columns.length > 0,
		),
	});

	const columnsForInsert = useMemo(() => {
		if (!propertiesQuery.data) {
			return [];
		}
		const resultColumnNames = new Set(
			columns.map((columnName) => normalizeColumnId(columnName)),
		);
		return propertiesQuery.data
			.filter(isInsertFormColumn)
			.filter((col) =>
				resultColumnNames.has(normalizeColumnId(col.columnName)),
			);
	}, [propertiesQuery.data, columns]);

	const metaByLowerName = useMemo(() => {
		const map = new Map<string, ColumnProperties>();
		for (const col of propertiesQuery.data ?? []) {
			map.set(normalizeColumnId(col.columnName), col);
		}
		return map;
	}, [propertiesQuery.data]);
	const insertBindingByResultColumn = useMemo(() => {
		const map = new Map<string, string>();
		for (const resultColumnName of columns) {
			const mapped = metaByLowerName.get(normalizeColumnId(resultColumnName));
			if (mapped && isInsertFormColumn(mapped)) {
				map.set(resultColumnName, mapped.columnName);
			}
		}
		return map;
	}, [columns, metaByLowerName]);

	const insertPlaceholderRow = useMemo(() => {
		const row: ResultRow = {};
		for (const columnName of columns) {
			row[columnName] = null;
		}
		return row;
	}, [columns]);

	const indexedRows = useMemo(() => {
		const rows = result?.rows ?? [];
		return rows.map((row, index) => {
			const pkValues = primaryKeyColumns.map(
				(columnName) => {
					const resolvedColumnName =
						resultColumnByLower.get(normalizeColumnId(columnName)) ?? columnName;
					return row[resolvedColumnName] ?? null;
				},
			);
			const hasCompletePrimaryKey =
				primaryKeyColumns.length > 0 &&
				pkValues.length === primaryKeyColumns.length &&
				pkValues.every((value) => value !== null);
			const rowId = hasCompletePrimaryKey
				? `pk:${pkValues.join("\u001f")}`
				: `idx:${index}`;
			const primaryKey = primaryKeyColumns.reduce<
				Record<string, string | null>
			>((accumulator, columnName) => {
				const resolvedColumnName =
					resultColumnByLower.get(normalizeColumnId(columnName)) ?? columnName;
				accumulator[columnName] = row[resolvedColumnName] ?? null;
				return accumulator;
			}, {});

			return {
				rowId,
				row,
				primaryKey,
				hasCompletePrimaryKey,
			};
		});
	}, [primaryKeyColumns, result?.rows, resultColumnByLower]);

	const originalByRowId = useMemo(
		() =>
			indexedRows.reduce<Record<string, ResultRow>>((accumulator, item) => {
				accumulator[item.rowId] = item.row;
				return accumulator;
			}, {}),
		[indexedRows],
	);

	const appendInsertRow = showInsertRow && canInsertRow && columns.length > 0;

	const data = useMemo(() => {
		const base = indexedRows.map((item) => item.row);
		if (appendInsertRow) {
			return [...base, insertPlaceholderRow];
		}
		return base;
	}, [appendInsertRow, indexedRows, insertPlaceholderRow]);

	useEffect(
		() => () => {
			if (resizeRafRef.current !== null) {
				window.cancelAnimationFrame(resizeRafRef.current);
				resizeRafRef.current = null;
			}
		},
		[],
	);

	const applyPendingEdit = useCallback(
		(rowId: string, columnId: string, raw: string) => {
			const nextValue = raw === "" ? null : raw;
			const originalValue = originalByRowId[rowId]?.[columnId] ?? null;
			setPendingEdits((current) => {
				const next = { ...current };
				const existing = { ...(next[rowId] ?? {}) };
				if (nextValue === originalValue) {
					delete existing[columnId];
				} else {
					existing[columnId] = nextValue;
				}

				if (Object.keys(existing).length === 0) {
					delete next[rowId];
				} else {
					next[rowId] = existing;
				}
				return next;
			});
		},
		[originalByRowId],
	);

	const resolveCellValue = useCallback(
		(rowId: string, columnId: string, fallback: string | null | undefined) =>
			pendingEdits[rowId]?.[columnId] ?? fallback ?? null,
		[pendingEdits],
	);

	const columnHelper = useMemo(() => createColumnHelper<ResultRow>(), []);
	const columnDefs = useMemo(
		() => [
			columnHelper.display({
				id: "__select",
				header: () => "Select",
				enableHiding: false,
				cell: (context) => {
					if (context.row.id === "__insert__") {
						return (
							<span
								className="inline-flex size-3.5 items-center justify-center rounded border border-dashed border-border bg-muted/20"
								aria-hidden
							/>
						);
					}
					return (
						<input
							type="checkbox"
							className="size-3.5 cursor-pointer"
							checked={context.row.getIsSelected()}
							onChange={context.row.getToggleSelectedHandler()}
							aria-label={`Select row ${context.row.index + 1}`}
						/>
					);
				},
			}),
			...columns.map((columnName) =>
				columnHelper.accessor(columnName, {
					id: columnName,
					header: () => columnName,
					cell: (context) => {
						const rowId = context.row.id;
						const columnId = context.column.id;
						const value = resolveCellValue(
							rowId,
							columnId,
							context.getValue() as string | null | undefined,
						);
						const isCellEditing =
							editingCell?.rowId === rowId &&
							editingCell.columnId === columnId;
						const normalizedColumnId = normalizeColumnId(columnId);
						const isColumnEditable =
							canEdit &&
							editableColumnsByLower.has(normalizedColumnId) &&
							!primaryKeyColumnsByLower.has(normalizedColumnId);

						if (rowId === "__insert__") {
							const mappedInsertColumn =
								insertBindingByResultColumn.get(columnId);
							const meta = mappedInsertColumn
								? metaByLowerName.get(normalizeColumnId(mappedInsertColumn))
								: undefined;
							if (!mappedInsertColumn || !meta) {
								return <span className="text-muted-foreground">—</span>;
							}
							return (
								<InsertRowInput
									value={insertDraft[mappedInsertColumn] ?? ""}
									onChange={(next) =>
										setInsertDraft((previous) => ({
											...previous,
											[mappedInsertColumn]: next,
										}))
									}
									placeholder={meta.isNullable ? "NULL if empty" : "Required"}
								/>
							);
						}

						if (!isColumnEditable) {
							return (
								<span
									className={`block min-w-0 truncate ${value === null ? "text-muted-foreground" : ""}`}
								>
									{formatValue(value)}
								</span>
							);
						}

						if (isCellEditing) {
							return (
								<ResultEditInput
									key={`${rowId}-${columnId}`}
									defaultValue={toEditableValue(value)}
									onEscape={() => setEditingCell(null)}
									onBlurCommit={(raw) => {
										applyPendingEdit(rowId, columnId, raw);
										setEditingCell(null);
									}}
								/>
							);
						}

						return (
							<button
								type="button"
								className={`w-full min-w-0 truncate text-left ${value === null ? "text-muted-foreground" : ""}`}
								title={t("editor.clickToEdit")}
								onClick={() => setEditingCell({ rowId, columnId })}
							>
								{formatValue(value)}
							</button>
						);
					},
				}),
			),
		],
		[
			applyPendingEdit,
			canEdit,
			columns,
			editableColumnsByLower,
			editingCell,
			insertBindingByResultColumn,
			insertDraft,
			metaByLowerName,
			primaryKeyColumnsByLower,
			resolveCellValue,
		],
	);

	// TanStack Table: React Compiler skips memoizing this hook by design.
	// eslint-disable-next-line react-hooks/incompatible-library -- useReactTable is intentionally dynamic
	const table = useReactTable({
		data,
		columns: columnDefs,
		getCoreRowModel: getCoreRowModel(),
		getRowId: (_row, index) => {
			if (appendInsertRow && index === indexedRows.length) {
				return "__insert__";
			}
			return indexedRows[index]?.rowId ?? `idx:${index}`;
		},
		state: {
			rowSelection,
			columnVisibility,
		},
		onRowSelectionChange: setRowSelection,
		onColumnVisibilityChange: setColumnVisibility,
		enableRowSelection: (row) => row.id !== "__insert__",
	});

	const rowVirtualizer = useVirtualizer({
		count: table.getRowModel().rows.length,
		getScrollElement: () => parentRef.current,
		estimateSize: () => 36,
		overscan: 10,
	});

	const visibleColumns = table.getVisibleLeafColumns();
	const selectColumn = visibleColumns.find((column) => column.id === "__select");
	const dataVisibleColumns = useMemo(
		() => visibleColumns.filter((column) => column.id !== "__select"),
		[visibleColumns],
	);

	const getColumnWidthPx = useCallback(
		(columnId: string) =>
			columnWidths[columnId] ??
			(columnId === "__select"
				? SELECT_COLUMN_WIDTH_PX
				: DEFAULT_DATA_COLUMN_WIDTH_PX),
		[columnWidths],
	);

	const templateColumns =
		visibleColumns.length > 0
			? visibleColumns
					.map((column) => `${getColumnWidthPx(column.id)}px`)
					.join(" ")
			: "minmax(0, 1fr)";
	void templateColumns;

	const columnVirtualizer = useVirtualizer({
		horizontal: true,
		count: dataVisibleColumns.length,
		getScrollElement: () => horizontalScrollRef.current,
		estimateSize: (index) => getColumnWidthPx(dataVisibleColumns[index]?.id ?? ""),
		overscan: 4,
	});

	useEffect(() => {
		columnVirtualizer.measure();
	}, [columnVirtualizer]);

	const virtualDataColumns = columnVirtualizer.getVirtualItems();
	const virtualPaddingLeft = virtualDataColumns[0]?.start ?? 0;
	const virtualPaddingRight =
		columnVirtualizer.getTotalSize() -
		(virtualDataColumns[virtualDataColumns.length - 1]?.end ?? 0);
	const selectColumnWidthPx = selectColumn
		? getColumnWidthPx(selectColumn.id)
		: SELECT_COLUMN_WIDTH_PX;
	const totalDataColumnsWidthPx = columnVirtualizer.getTotalSize();
	const totalGridWidthPx = selectColumnWidthPx + totalDataColumnsWidthPx;

	const handleColumnResizePointerDown = useCallback(
		(columnId: string, event: PointerEvent<HTMLElement>) => {
			event.preventDefault();
			event.stopPropagation();
			const startX = event.clientX;
			const startWidth = getColumnWidthPx(columnId);

			const clampWidth = (value: number) =>
				Math.min(MAX_COLUMN_WIDTH_PX, Math.max(MIN_COLUMN_WIDTH_PX, value));

			const onPointerMove = (moveEvent: globalThis.PointerEvent) => {
				const delta = moveEvent.clientX - startX;
				const nextWidth = clampWidth(startWidth + delta);
				pendingResizeWidthsRef.current[columnId] = nextWidth;
				if (resizeRafRef.current === null) {
					resizeRafRef.current = window.requestAnimationFrame(() => {
						resizeRafRef.current = null;
						const pending = pendingResizeWidthsRef.current;
						pendingResizeWidthsRef.current = {};
						setColumnWidths((current) => ({ ...current, ...pending }));
					});
				}
			};

			const onPointerUp = () => {
				if (resizeRafRef.current !== null) {
					window.cancelAnimationFrame(resizeRafRef.current);
					resizeRafRef.current = null;
				}
				if (Object.keys(pendingResizeWidthsRef.current).length > 0) {
					const pending = pendingResizeWidthsRef.current;
					pendingResizeWidthsRef.current = {};
					setColumnWidths((current) => ({ ...current, ...pending }));
				}
				window.removeEventListener("pointermove", onPointerMove);
				window.removeEventListener("pointerup", onPointerUp);
				window.removeEventListener("pointercancel", onPointerUp);
			};

			window.addEventListener("pointermove", onPointerMove);
			window.addEventListener("pointerup", onPointerUp);
			window.addEventListener("pointercancel", onPointerUp);
		},
		[getColumnWidthPx],
	);

	const renderBodyCell = useCallback((cell: Cell<ResultRow, unknown>) => {
		const cellDef = cell.column.columnDef.cell;
		if (cellDef) {
			return flexRender(cellDef, cell.getContext());
		}
		return formatValue(cell.getValue() as string | null);
	}, []);

	const hasEdits = Object.keys(pendingEdits).length > 0 || editingCell !== null;

	useEffect(() => {
		setColumnWidths((previous) => {
			const identifiers = ["__select", ...columns];
			const next: Record<string, number> = {};
			for (const id of identifiers) {
				const fallback =
					id === "__select"
						? SELECT_COLUMN_WIDTH_PX
						: DEFAULT_DATA_COLUMN_WIDTH_PX;
				next[id] = previous[id] ?? fallback;
			}
			return next;
		});
	}, [columns]);

	useEffect(() => {
		void queryResultEditResetKey;
		setPendingEdits({});
		setRowSelection({});
		setEditingCell(null);
		setGridError(null);
		setShowInsertRow(false);
		setInsertDraft({});
	}, [queryResultEditResetKey]);

	useEffect(() => {
		if (!canInsertRow) {
			setShowInsertRow(false);
			setInsertDraft({});
		}
	}, [canInsertRow]);

	useEffect(() => {
		const isNewInsertTrigger = insertRowTrigger > lastInsertRowTriggerRef.current;
		lastInsertRowTriggerRef.current = insertRowTrigger;
		if (!isNewInsertTrigger || !canInsertRow) {
			return;
		}
		if (columns.length > 0) {
			setShowInsertRow(true);
			return;
		}
		if (columns.length === 0) {
			setGridError(
				t("editor.insertNoColumns"),
			);
		}
	}, [insertRowTrigger, canInsertRow, columns.length]);

	useLayoutEffect(() => {
		if (!appendInsertRow) {
			return;
		}
		const element = parentRef.current;
		if (element) {
			element.scrollTop = element.scrollHeight;
		}
	}, [appendInsertRow]);

	const handleSave = async () => {
		if (!onSaveEdits) {
			return;
		}
		if (!canEdit) {
			setGridError(
				saveDisabledReason ?? t("editor.editingDisabled"),
			);
			return;
		}
		if (editingCell) {
			const activeElement = document.activeElement;
			if (activeElement instanceof HTMLElement) {
				activeElement.blur();
			}
			await Promise.resolve();
		}

		const patches: ResultEditPatch[] = Object.entries(pendingEdits)
			.map(([rowId, changes]) => {
				const source = indexedRows.find((row) => row.rowId === rowId);
				const mappedChanges = Object.entries(changes).reduce<
					Record<string, string | null>
				>((accumulator, [columnId, value]) => {
					const mappedColumnName = editableColumnsByLower.get(
						normalizeColumnId(columnId),
					);
					if (mappedColumnName) {
						accumulator[mappedColumnName] = value;
					}
					return accumulator;
				}, {});
				if (
					!source ||
					!source.hasCompletePrimaryKey ||
					Object.keys(mappedChanges).length === 0
				) {
					return null;
				}

				return {
					rowId,
					primaryKey: source.primaryKey,
					changes: mappedChanges,
				};
			})
			.filter((patch): patch is ResultEditPatch => patch !== null);

		if (patches.length === 0) {
		setGridError(
			t("editor.noEditableChanges"),
		);
			return;
		}

		setGridError(null);
		try {
			await onSaveEdits(patches);
			setPendingEdits({});
		} catch (error) {
			const message =
				error instanceof Error ? error.message : "Failed to save edits.";
			setGridError(message);
		}
	};

	const handleDeleteRows = async () => {
		if (!onDeleteRows) return;

		const selectedRowIds = Object.keys(rowSelection);
		if (selectedRowIds.length === 0) {
			setGridError(t("editor.selectRowsToDelete"));
			return;
		}

		const pkValues: Record<string, string | null>[] = [];
		for (const rowId of selectedRowIds) {
			const source = indexedRows.find((row) => row.rowId === rowId);
			if (source?.hasCompletePrimaryKey) {
				pkValues.push(source.primaryKey);
			}
		}

		if (pkValues.length === 0) {
			setGridError(t("editor.noUsablePrimaryKey"));
			return;
		}

		const confirmed = window.confirm(
			`Delete ${pkValues.length} selected row(s)? This action cannot be undone.`,
		);
		if (!confirmed) return;

		setGridError(null);
		setDeleteBusy(true);
		try {
			await onDeleteRows(pkValues);
			setRowSelection({});
		} catch (error) {
			const message =
				error instanceof Error ? error.message : "Failed to delete rows.";
			setGridError(message);
		} finally {
			setDeleteBusy(false);
		}
	};

	const getRowsForAction = () => {
		const selected = table.getSelectedRowModel().rows;
		const targetRows =
			selected.length > 0 ? selected : table.getRowModel().rows;

		return targetRows
			.filter((row) => row.id !== "__insert__")
			.map((row) => row.original);
	};

	const handleCopy = async () => {
		const selectedRows = getRowsForAction();
		const exportColumns = visibleColumns
			.filter((column) => column.id !== "__select")
			.map((column) => column.id);
		if (exportColumns.length === 0) {
			setGridError(t("editor.noVisibleColumnsToCopy"));
			return;
		}

		setGridError(null);
		try {
			await copyRows(exportColumns, selectedRows);
		} catch (error) {
			const message =
				error instanceof Error ? error.message : "Failed to copy rows.";
			setGridError(message);
			notifyError(error, { title: t("editor.copyFailed"), category: "internal" });
		}
	};

	const handleDownloadCsv = async () => {
		const exportColumns = visibleColumns
			.filter((column) => column.id !== "__select")
			.map((column) => column.id);
		if (exportColumns.length === 0) {
			setGridError(t("editor.noVisibleColumnsToExport"));
			return;
		}

		setGridError(null);
		try {
			await downloadRowsAsCsv(
				"query-results.csv",
				exportColumns,
				getRowsForAction(),
			);
		} catch (error) {
			const message =
				error instanceof Error ? error.message : t("editor.failedToDownloadCsv");
			setGridError(message);
			notifyError(error, { title: "CSV export failed", category: "internal" });
		}
	};

	const handleDownloadJson = async () => {
		const exportColumns = visibleColumns
			.filter((column) => column.id !== "__select")
			.map((column) => column.id);
		if (exportColumns.length === 0) {
			setGridError(t("editor.noVisibleColumnsToExport"));
			return;
		}

		setGridError(null);
		try {
			await downloadRowsAsJson(
				"query-results.json",
				exportColumns,
				getRowsForAction(),
			);
		} catch (error) {
			const message =
				error instanceof Error ? error.message : t("editor.failedToDownloadJson");
			setGridError(message);
			notifyError(error, { title: "JSON export failed", category: "internal" });
		}
	};

	const handleInsertRow = async () => {
		if (!insertConnectionId || !insertTable || !propertiesQuery.data) {
			return;
		}

		const columnsPayload: InsertRowColumnValue[] = [];
		const missing: string[] = [];

		for (const col of columnsForInsert) {
			const raw = (insertDraft[col.columnName] ?? "").trim();
			if (raw === "") {
				if (!col.isNullable) {
					missing.push(col.columnName);
				} else {
					columnsPayload.push({ columnName: col.columnName, value: null });
				}
			} else {
				columnsPayload.push({ columnName: col.columnName, value: raw });
			}
		}

		if (missing.length > 0) {
			setGridError(t("editor.requiredValuesMissing", { fields: missing.join(", ") }));
			return;
		}

		setGridError(null);
		try {
			await insertMutation.mutateAsync({
				connectionId: insertConnectionId,
				table: insertTable,
				columns: columnsPayload,
			});
			setInsertDraft({});
			setShowInsertRow(false);
			insertMutation.reset();
			onInsertRowSuccess();
		} catch (error) {
			const message = error instanceof Error ? error.message : t("editor.insertFailed");
			setGridError(message);
		}
	};

	const handleCancelInsert = () => {
		setShowInsertRow(false);
		setInsertDraft({});
		setGridError(null);
		insertMutation.reset();
	};

	const insertRowVisible = appendInsertRow;
	const insertDisabled =
		propertiesQuery.isLoading ||
		propertiesQuery.isError ||
		columnsForInsert.length === 0;

	const toolbarBusy = isSaving || insertMutation.isPending;

	const hasRowset = result != null && result.columns.length > 0;

	if (isPending) {
		return renderLoadingSkeleton();
	}

	return (
		<div className="flex h-full min-w-0 flex-col overflow-hidden">
			<ResultsToolbar
				columns={table.getAllLeafColumns().map((column) => ({
					id: column.id,
					label: column.id === "__select" ? "Select" : column.id,
					visible: column.getIsVisible(),
					canHide: column.getCanHide(),
				}))}
				canEdit={canEdit}
				isDirty={hasEdits}
				isBusy={toolbarBusy}
				onToggleColumn={(columnId, visible) =>
					table.getColumn(columnId)?.toggleVisibility(visible)
				}
				onRefresh={() => onRefresh?.()}
				onCopy={() => {
					void handleCopy();
				}}
				onDownloadCsv={() => {
					void handleDownloadCsv();
				}}
				onDownloadJson={() => {
					void handleDownloadJson();
				}}
				onSave={() => {
					void handleSave();
				}}
				onAddRow={canInsertRow ? onAddRow : undefined}
				insertRowVisible={insertRowVisible}
				onInsertRow={
					insertRowVisible ? () => void handleInsertRow() : undefined
				}
				onCancelInsert={insertRowVisible ? handleCancelInsert : undefined}
				insertBusy={insertMutation.isPending}
            insertDisabled={insertDisabled}
            selectionCount={Object.keys(rowSelection).length}
            onDeleteRows={onDeleteRows ? () => void handleDeleteRows() : undefined}
            deleteBusy={deleteBusy}
            deleteDisabledReason={
              !canEdit
                ? saveDisabledReason
                : Object.keys(rowSelection).length === 0
                  ? t("editor.selectRowsToDelete")
                  : undefined
            }
          />
			{hasRowset ? (
				<div
					ref={horizontalScrollRef}
					className="min-h-0 min-w-0 flex-1 overflow-x-auto"
				>
					<div
						className="flex h-full min-w-full flex-col"
						style={{ width: `${Math.max(totalGridWidthPx, 0)}px` }}
					>
						<div
							className="sticky top-0 z-10 flex min-w-full shrink-0 border-b border-border bg-muted/30"
						>
							{selectColumn ? (
								<div
									key={selectColumn.id}
									className="relative min-w-0 truncate border-r border-border px-3 py-2 pr-2 text-[11px] font-medium text-muted-foreground last:border-r-0"
									style={{ width: `${selectColumnWidthPx}px` }}
								>
									<span className="block truncate">
										Select
									</span>
									<button
										type="button"
										tabIndex={-1}
										aria-label="Resize column Select"
										className="absolute right-0 top-0 z-10 h-full w-2 cursor-col-resize select-none border-0 bg-transparent p-0 hover:bg-primary/20"
										onPointerDown={(event) =>
											handleColumnResizePointerDown(selectColumn.id, event)
										}
									/>
								</div>
							) : null}
							{virtualPaddingLeft > 0 ? (
								<div
									aria-hidden
									style={{ width: `${virtualPaddingLeft}px`, minWidth: `${virtualPaddingLeft}px` }}
								/>
							) : null}
							{virtualDataColumns.map((virtualColumn) => {
								const column = dataVisibleColumns[virtualColumn.index];
								if (!column) {
									return null;
								}
								const widthPx = getColumnWidthPx(column.id);
								return (
									<div
										key={column.id}
										className="relative min-w-0 truncate border-r border-border px-3 py-2 pr-2 text-[11px] font-medium text-muted-foreground last:border-r-0"
										style={{ width: `${widthPx}px`, minWidth: `${widthPx}px` }}
									>
										<span className="block truncate">{column.id}</span>
										<button
											type="button"
											tabIndex={-1}
											aria-label={`Resize column ${column.id}`}
											className="absolute right-0 top-0 z-10 h-full w-2 cursor-col-resize select-none border-0 bg-transparent p-0 hover:bg-primary/20"
											onPointerDown={(event) =>
												handleColumnResizePointerDown(column.id, event)
											}
										/>
									</div>
								);
							})}
							{virtualPaddingRight > 0 ? (
								<div
									aria-hidden
									style={{
										width: `${virtualPaddingRight}px`,
										minWidth: `${virtualPaddingRight}px`,
									}}
								/>
							) : null}
						</div>
						<div
							ref={parentRef}
							className="min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden"
						>
							<div
								className="relative w-max min-w-full"
								style={{ height: `${rowVirtualizer.getTotalSize()}px` }}
							>
								{rowVirtualizer.getVirtualItems().map((virtualRow) => {
									const row = table.getRowModel().rows[virtualRow.index];
									if (!row) {
										return null;
									}

									const isInsert = row.id === "__insert__";

									return (
										<div
											key={row.id}
											className={`absolute left-0 top-0 flex w-max min-w-full border-b border-border/60 text-xs ${
												isInsert
													? "bg-muted/25"
													: row.getIsSelected()
														? "bg-muted/40"
														: "bg-background"
											}`}
											style={{
												height: `${virtualRow.size}px`,
												transform: `translateY(${virtualRow.start}px)`,
												width: `${Math.max(totalGridWidthPx, 0)}px`,
											}}
										>
											{(() => {
												const rowCells = row.getVisibleCells();
												const rowCellByColumn = new Map(
													rowCells.map((cell) => [cell.column.id, cell]),
												);
												const selectCell = selectColumn
													? rowCellByColumn.get(selectColumn.id)
													: undefined;
												return (
													<>
														{selectCell ? (
															<div
																key={selectCell.id}
																className="min-w-0 truncate border-r border-border/60 px-3 py-2"
																style={{
																	width: `${selectColumnWidthPx}px`,
																	minWidth: `${selectColumnWidthPx}px`,
																}}
															>
																{renderBodyCell(selectCell)}
															</div>
														) : null}
														{virtualPaddingLeft > 0 ? (
															<div
																aria-hidden
																style={{
																	width: `${virtualPaddingLeft}px`,
																	minWidth: `${virtualPaddingLeft}px`,
																}}
															/>
														) : null}
														{virtualDataColumns.map((virtualColumn) => {
															const column =
																dataVisibleColumns[virtualColumn.index];
															if (!column) {
																return null;
															}
															const cell = rowCellByColumn.get(column.id);
															if (!cell) {
																return null;
															}
															const widthPx = getColumnWidthPx(column.id);
															const cellValue = resolveCellValue(
																row.id,
																column.id,
																cell.getValue() as string | null | undefined,
															);
															return (
																<div
																	key={cell.id}
																	className={`min-w-0 truncate border-r border-border/60 px-3 py-2 ${clickToCopy ? 'cursor-copy hover:bg-accent/30 active:bg-accent/50' : ''} ${copiedCellId === cell.id ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : ''}`}
																	style={{
																		width: `${widthPx}px`,
																		minWidth: `${widthPx}px`,
																	}}
																	title={`${formatValue(cellValue)}${copiedCellId === cell.id ? ' — Copied!' : clickToCopy ? '\nClick to copy' : ''}`}
																	onClick={() => {
																		if (!clickToCopy) return
																		const text = formatValue(cellValue)
																		if (!text) return
																		navigator.clipboard.writeText(text)
																		setCopiedCellId(cell.id)
																		if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current)
																		copyTimeoutRef.current = window.setTimeout(() => setCopiedCellId(null), 1200)
																	}}
																>
																	{renderBodyCell(cell)}
																</div>
															);
														})}
														{virtualPaddingRight > 0 ? (
															<div
																aria-hidden
																style={{
																	width: `${virtualPaddingRight}px`,
																	minWidth: `${virtualPaddingRight}px`,
																}}
															/>
														) : null}
													</>
												);
											})()}
										</div>
									);
								})}
							</div>
						</div>
					</div>
				</div>
			) : (
				<div className="flex min-h-0 min-w-0 flex-1 flex-col items-center justify-center gap-2 px-4 text-center text-xs text-muted-foreground">
					{result == null ? (
						<>
							<span>{t("editor.runQueryToSeeResults")}</span>
							{canInsertRow ? (
								<span className="max-w-md">
									{t("editor.addRowHint")}
								</span>
							) : null}
						</>
					) : (
						<>
							<span>{t("editor.statementCompleted")}</span>
							<span>
								{result.commandTag
									? t("editor.rowsAffected", { count: result.commandTag })
									: t("editor.noRowsReturned")}
							</span>
							{canInsertRow ? (
								<span className="max-w-md">
									{t("editor.inlineAddRowHint")}
								</span>
							) : null}
						</>
					)}
				</div>
			)}
			<div className="border-t border-border bg-muted/10 px-3 py-1.5 text-[11px] text-muted-foreground">
				{saveDisabledReason && !canEdit
					? saveDisabledReason
					: t("editor.rowsSelected", { count: Object.keys(rowSelection).length })}
			</div>
			{gridError ? (
				<div className="border-t border-border bg-destructive/10 px-3 py-1.5 text-[11px] text-destructive">
					{gridError}
				</div>
			) : null}
		</div>
	);
}
