import {
	type Cell,
	createColumnHelper,
	flexRender,
	getCoreRowModel,
	getFilteredRowModel,
	getSortedRowModel,
	type RowSelectionState,
	type SortingState,
	type Table,
	useReactTable,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
	type ChangeEvent,
	type PointerEvent,
	type ReactNode,
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { BracketsCurly } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import {
	ArrowsDownUpIcon,
	CaretDownIcon,
	CaretUpIcon,
	CopyIcon,
	KeyIcon,
	MagnifyingGlassIcon,
	SidebarSimpleIcon,
	TrashIcon,
} from "@phosphor-icons/react";

import type { ColumnProperties, QueryResult, TableInfo } from "@/data/types";
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuSeparator,
	ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { CellBadgeRenderer } from "@/features/queries/components/CellBadgeRenderer";
import { CellInspectorDrawer } from "@/features/queries/components/CellInspectorDrawer";
import { ResultEditInput, InsertRowInput } from "@/features/queries/components/ResultsCellEditor";
import { JsonCellDialog } from "@/features/queries/components/JsonCellDialog";
import { isJsonValue } from "@/features/queries/json-cell";
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
	copyRowsAsMarkdown,
	copyRowsAsSqlInsert,
	downloadRowsAsCsv,
	downloadRowsAsJson,
} from "@/features/queries/results-export";
import { useTablePropertiesQuery } from "@/features/schema/queries";
import { notifyError } from "@/lib/error-notifier";
import { resolveFontSizePx, useSettings } from "@/lib/settings";
import { cn } from "@/lib/utils";

const SELECT_COLUMN_WIDTH_PX = 44;
const ROW_NUMBER_COLUMN_WIDTH_PX = 44;
const DEFAULT_DATA_COLUMN_WIDTH_PX = 180;
const MIN_COLUMN_WIDTH_PX = 48;
const MAX_COLUMN_WIDTH_PX = 640;
/** Row height as a multiple of the root font size, so rows grow with the font-size setting. */
const ROW_HEIGHT_EM = 2.25;
const MIN_ROW_HEIGHT_PX = 28;

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
	/** opens the Chart Builder for this result. Hidden when omitted. */
	onCreateChart?: () => void;
	canCreateChart?: boolean;
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

type PendingEditsMap = Record<string, Record<string, string | null>>;

function mergePendingEdit(
	current: PendingEditsMap,
	rowId: string,
	columnId: string,
	raw: string,
	originalValue: string | null,
): PendingEditsMap {
	const nextValue = raw === "" ? null : raw;
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
}

function toEditableValue(value: string | null | undefined) {
	return value ?? "";
}

function normalizeColumnId(columnId: string) {
	return columnId.toLowerCase();
}

/** TanStack Table sorting wrapper that guarantees __insert__ stays pinned at the bottom */
function getCustomSortedRowModel<TData>() {
	const baseSortedModel = getSortedRowModel<TData>();
	return (table: Table<TData>) => {
		const baseFn = baseSortedModel(table);
		return () => {
			const model = baseFn();
			if (!model.rows.some((r) => r.id === "__insert__")) {
				return model;
			}
			const dataRows = model.rows.filter((r) => r.id !== "__insert__");
			const insertRows = model.rows.filter((r) => r.id === "__insert__");
			const combined = [...dataRows, ...insertRows];
			return {
				...model,
				rows: combined,
				flatRows: combined,
			};
		};
	};
}

/** TanStack Table filter wrapper that keeps __insert__ row visible when typing a filter */
function getCustomFilteredRowModel<TData>() {
	const baseFilteredModel = getFilteredRowModel<TData>();
	return (table: Table<TData>) => {
		const baseFn = baseFilteredModel(table);
		return () => {
			const model = baseFn();
			const hasInsertInCore = table.getCoreRowModel().rows.some((r) => r.id === "__insert__");
			if (!hasInsertInCore || model.rows.some((r) => r.id === "__insert__")) {
				return model;
			}
			const insertRow = table.getCoreRowModel().rows.find((r) => r.id === "__insert__");
			if (insertRow) {
				return {
					...model,
					rows: [...model.rows, insertRow],
					flatRows: [...model.flatRows, insertRow],
				};
			}
			return model;
		};
	};
}

function SelectAllCheckbox({
	checked,
	indeterminate,
	disabled,
	label,
	onChange,
}: {
	checked: boolean;
	indeterminate: boolean;
	disabled: boolean;
	label: string;
	onChange: (event: ChangeEvent<HTMLInputElement>) => void;
}) {
	const ref = useRef<HTMLInputElement | null>(null);
	useEffect(() => {
		if (ref.current) {
			ref.current.indeterminate = indeterminate;
		}
	}, [indeterminate]);
	return (
		<input
			ref={ref}
			type="checkbox"
			className="size-3.5 cursor-pointer"
			checked={checked}
			disabled={disabled}
			onChange={onChange}
			aria-label={label}
		/>
	);
}

function renderLoadingSkeleton() {
	const dataColumnCount = 4;
	const placeholderRows = 10;
	const skeletonTemplateColumns = [
		`${SELECT_COLUMN_WIDTH_PX}px`,
		`${ROW_NUMBER_COLUMN_WIDTH_PX}px`,
		...Array.from(
			{ length: dataColumnCount },
			() => `${DEFAULT_DATA_COLUMN_WIDTH_PX}px`,
		),
	].join(" ");
	const columnIndices = Array.from(
		{ length: 2 + dataColumnCount },
		(_, index) => index,
	);
	const rowKeys = Array.from(
		{ length: placeholderRows },
		(_, index) => `skeleton-row-${index}`,
	);

	const toolbarColumns = [
		{ id: "__select", label: "Select", visible: true, canHide: false },
		{ id: "__rowNumber", label: "#", visible: true, canHide: false },
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
									className={`h-3 animate-pulse rounded-sm bg-muted ${
										columnIndex === 0 ? "w-6" : columnIndex === 1 ? "w-5" : "w-24 max-w-full"
									}`}
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
	onCreateChart,
	canCreateChart,
}: ResultsGridProps) {
	const { t } = useTranslation();
	/** Single scroll container for both axes, so the sticky header and both scrollbars stay in view. */
	const parentRef = useRef<HTMLDivElement | null>(null);
	const filterInputRef = useRef<HTMLInputElement | null>(null);
	const contextMenuTargetRef = useRef<{
		rowId: string;
		columnId: string;
		value: string | null;
		rowIndex: number;
		row: ResultRow;
	} | null>(null);
	const [contextMenuTarget, setContextMenuTarget] = useState<{
		rowId: string;
		columnId: string;
		value: string | null;
		rowIndex: number;
		row: ResultRow;
	} | null>(null);

	const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
	const [columnVisibility, setColumnVisibility] = useState<Record<string, boolean>>({});
	const [columnWidths, setColumnWidths] = useState<Record<string, number>>({});
	const [sorting, setSorting] = useState<SortingState>([]);
	const [globalFilter, setGlobalFilter] = useState("");
	const [pendingEdits, setPendingEdits] = useState<PendingEditsMap>({});
	const [editingCell, setEditingCell] = useState<{
		rowId: string;
		columnId: string;
	} | null>(null);
	const [inspectedCell, setInspectedCell] = useState<{
		rowId: string;
		columnId: string;
		value: string | null;
		rowIndex: number;
	} | null>(null);
	const [isInspectorOpen, setIsInspectorOpen] = useState(false);
	const [gridError, setGridError] = useState<string | null>(null);
	const [jsonView, setJsonView] = useState<{
		rowId: string;
		columnId: string;
		value: string;
		editable: boolean;
	} | null>(null);
	const [showInsertRow, setShowInsertRow] = useState(false);
	const [insertDraft, setInsertDraft] = useState<Record<string, string>>({});
	const [deleteBusy, setDeleteBusy] = useState(false);
	const lastInsertRowTriggerRef = useRef(insertRowTrigger);
	const resizeRafRef = useRef<number | null>(null);
	const pendingResizeWidthsRef = useRef<Record<string, number>>({});
	const [copiedCellId, setCopiedCellId] = useState<string | null>(null);
	const copyTimeoutRef = useRef<number | null>(null);
	const clickToCopy = useSettings((s) => s.clickToCopy);
	const rootFontSizePx = useSettings((s) => resolveFontSizePx(s.fontSize));
	const rowHeightPx = Math.max(
		MIN_ROW_HEIGHT_PX,
		Math.round(rootFontSizePx * ROW_HEIGHT_EM),
	);

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
			const pkValues = primaryKeyColumns.map((columnName) => {
				const resolvedColumnName =
					resultColumnByLower.get(normalizeColumnId(columnName)) ?? columnName;
				return row[resolvedColumnName] ?? null;
			});
			const hasCompletePrimaryKey =
				primaryKeyColumns.length > 0 &&
				pkValues.length === primaryKeyColumns.length &&
				pkValues.every((value) => value !== null);
			const rowId = hasCompletePrimaryKey
				? `pk:${pkValues.join("\u001f")}`
				: `idx:${index}`;
			const primaryKey = primaryKeyColumns.reduce<Record<string, string | null>>(
				(accumulator, columnName) => {
					const resolvedColumnName =
						resultColumnByLower.get(normalizeColumnId(columnName)) ?? columnName;
					accumulator[columnName] = row[resolvedColumnName] ?? null;
					return accumulator;
				},
				{},
			);

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

	// Keyboard shortcut for Cmd+F / Ctrl+F
	useEffect(() => {
		const handleKeyDown = (e: KeyboardEvent) => {
			if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "f") {
				const active = document.activeElement;
				// Avoid hijacking when inside a CodeMirror editor
				if (
					active?.closest(".cm-editor") ||
					active?.tagName === "TEXTAREA"
				) {
					return;
				}
				e.preventDefault();
				filterInputRef.current?.focus();
				filterInputRef.current?.select();
			}
		};
		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, []);

	const applyPendingEdit = useCallback(
		(rowId: string, columnId: string, raw: string) => {
			const originalValue = originalByRowId[rowId]?.[columnId] ?? null;
			setPendingEdits((current) =>
				mergePendingEdit(current, rowId, columnId, raw, originalValue),
			);
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
				enableSorting: false,
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
							aria-label={t("editor.selectRow", { index: context.row.index + 1 })}
						/>
					);
				},
			}),
			columnHelper.display({
				id: "__rowNumber",
				header: () => "#",
				enableHiding: false,
				enableSorting: false,
				cell: (context) => {
					if (context.row.id === "__insert__") {
						return (
							<span className="font-mono text-muted-foreground/60 select-none">
								+
							</span>
						);
					}
					return (
						<span className="font-mono text-[11px] text-muted-foreground/60 select-none">
							{context.row.index + 1}
						</span>
					);
				},
			}),
			...columns.map((columnName) =>
				columnHelper.accessor(columnName, {
					id: columnName,
					header: () => columnName,
					enableSorting: true,
					sortingFn: (rowA, rowB, columnId) => {
						const valA = resolveCellValue(
							rowA.id,
							columnId,
							rowA.getValue(columnId) as string | null,
						);
						const valB = resolveCellValue(
							rowB.id,
							columnId,
							rowB.getValue(columnId) as string | null,
						);
						if (valA === valB) return 0;
						if (valA === null || valA === undefined) return -1;
						if (valB === null || valB === undefined) return 1;
						const numA = Number(valA);
						const numB = Number(valB);
						if (
							!isNaN(numA) &&
							!isNaN(numB) &&
							valA.trim() !== "" &&
							valB.trim() !== ""
						) {
							return numA < numB ? -1 : 1;
						}
						return String(valA).localeCompare(String(valB), undefined, {
							numeric: true,
							sensitivity: "base",
						});
					},
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

						const withJsonIcon = (node: ReactNode) =>
							isJsonValue(value) ? (
								<span className="flex min-w-0 items-center gap-1">
									<button
										type="button"
										className="shrink-0 text-muted-foreground hover:text-foreground"
										title={t("editor.jsonView")}
										aria-label={t("editor.jsonView")}
										onClick={(event) => {
											event.stopPropagation();
											setJsonView({
												rowId,
												columnId,
												value: value as string,
												editable: isColumnEditable && !isCellEditing,
											});
										}}
									>
										<BracketsCurly size={14} aria-hidden />
									</button>
									<span className="min-w-0 flex-1 truncate">{node}</span>
								</span>
							) : (
								node
							);

						if (!isColumnEditable) {
							return withJsonIcon(
								<CellBadgeRenderer
									value={value}
									highlightQuery={globalFilter}
								/>,
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

						return withJsonIcon(
							<button
								type="button"
								className="w-full min-w-0 truncate text-left"
								title={t("editor.clickToEdit")}
								onClick={() => setEditingCell({ rowId, columnId })}
							>
								<CellBadgeRenderer
									value={value}
									highlightQuery={globalFilter}
								/>
							</button>,
						);
					},
				}),
			),
		],
		[
			applyPendingEdit,
			canEdit,
			columnHelper,
			columns,
			editableColumnsByLower,
			editingCell,
			globalFilter,
			insertBindingByResultColumn,
			insertDraft,
			metaByLowerName,
			primaryKeyColumnsByLower,
			resolveCellValue,
			t,
		],
	);

	const globalFilterFn = useCallback(
		(row: { id: string; getValue: (col: string) => unknown }, _col: string, filterValue: unknown) => {
			if (row.id === "__insert__") return true;
			if (!filterValue) return true;
			const query = String(filterValue).toLowerCase().trim();
			for (const colId of columns) {
				const val = resolveCellValue(row.id, colId, row.getValue(colId) as string | null);
				if (val && String(val).toLowerCase().includes(query)) {
					return true;
				}
			}
			return false;
		},
		[columns, resolveCellValue],
	);

	// TanStack Table: React Compiler skips memoizing this hook by design.
	// eslint-disable-next-line react-hooks/incompatible-library -- useReactTable is intentionally dynamic
	const table = useReactTable({
		data,
		columns: columnDefs,
		getCoreRowModel: getCoreRowModel(),
		getSortedRowModel: getCustomSortedRowModel(),
		getFilteredRowModel: getCustomFilteredRowModel(),
		globalFilterFn,
		getRowId: (_row, index) => {
			if (appendInsertRow && index === indexedRows.length) {
				return "__insert__";
			}
			return indexedRows[index]?.rowId ?? `idx:${index}`;
		},
		state: {
			rowSelection,
			columnVisibility,
			sorting,
			globalFilter,
		},
		onRowSelectionChange: setRowSelection,
		onColumnVisibilityChange: setColumnVisibility,
		onSortingChange: setSorting,
		onGlobalFilterChange: setGlobalFilter,
		enableRowSelection: (row) => row.id !== "__insert__",
	});

	const tableRows = table.getRowModel().rows;

	const rowVirtualizer = useVirtualizer({
		count: tableRows.length,
		getScrollElement: () => parentRef.current,
		estimateSize: () => rowHeightPx,
		overscan: 12,
	});

	const visibleColumns = table.getVisibleLeafColumns();
	const selectColumn = visibleColumns.find((column) => column.id === "__select");
	const rowNumberColumn = visibleColumns.find((column) => column.id === "__rowNumber");
	const dataVisibleColumns = useMemo(
		() =>
			visibleColumns.filter(
				(column) => column.id !== "__select" && column.id !== "__rowNumber",
			),
		[visibleColumns],
	);

	const getColumnWidthPx = useCallback(
		(columnId: string) =>
			columnWidths[columnId] ??
			(columnId === "__select"
				? SELECT_COLUMN_WIDTH_PX
				: columnId === "__rowNumber"
					? ROW_NUMBER_COLUMN_WIDTH_PX
					: DEFAULT_DATA_COLUMN_WIDTH_PX),
		[columnWidths],
	);

	const columnVirtualizer = useVirtualizer({
		horizontal: true,
		count: dataVisibleColumns.length,
		getScrollElement: () => parentRef.current,
		estimateSize: (index) => getColumnWidthPx(dataVisibleColumns[index]?.id ?? ""),
		overscan: 4,
	});

	// The virtualizer caches sizes from `estimateSize` and only recomputes when the
	// item count changes. Without an explicit re-measure, resizing a column (or
	// changing the font size) leaves stale offsets behind, and cells drift out of
	// alignment or overlap. Layout effects re-render before paint, so no flicker.
	const columnLayoutKey = dataVisibleColumns
		.map((column) => `${column.id}:${getColumnWidthPx(column.id)}`)
		.join("\u0001");
	useLayoutEffect(() => {
		void columnLayoutKey;
		columnVirtualizer.measure();
	}, [columnVirtualizer, columnLayoutKey]);
	useLayoutEffect(() => {
		void rowHeightPx;
		rowVirtualizer.measure();
	}, [rowVirtualizer, rowHeightPx]);

	const virtualDataColumns = columnVirtualizer.getVirtualItems();
	const selectColumnWidthPx = selectColumn ? getColumnWidthPx(selectColumn.id) : 0;
	const rowNumberColumnWidthPx = rowNumberColumn
		? getColumnWidthPx(rowNumberColumn.id)
		: 0;
	// Derive widths from the real column widths rather than the virtualizer, so the
	// scrollable area always matches what is rendered.
	const totalDataColumnsWidthPx = dataVisibleColumns.reduce(
		(sum, column) => sum + getColumnWidthPx(column.id),
		0,
	);
	const virtualPaddingLeft = virtualDataColumns[0]?.start ?? 0;
	const virtualPaddingRight = Math.max(
		0,
		totalDataColumnsWidthPx -
			(virtualDataColumns[virtualDataColumns.length - 1]?.end ?? 0),
	);
	const totalGridWidthPx =
		selectColumnWidthPx + rowNumberColumnWidthPx + totalDataColumnsWidthPx;

	const handleColumnResizePointerDown = useCallback(
		(columnId: string, event: PointerEvent<HTMLElement>) => {
			event.preventDefault();
			event.stopPropagation();
			const startX = event.clientX;
			const startWidth = getColumnWidthPx(columnId);

			const clampWidth = (value: number) =>
				Math.min(MAX_COLUMN_WIDTH_PX, Math.max(MIN_COLUMN_WIDTH_PX, value));
			const previousCursor = document.body.style.cursor;
			const previousUserSelect = document.body.style.userSelect;
			document.body.style.cursor = "col-resize";
			document.body.style.userSelect = "none";

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
				document.body.style.cursor = previousCursor;
				document.body.style.userSelect = previousUserSelect;
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

	const handleColumnAutoFit = useCallback(
		(columnId: string, event: React.MouseEvent) => {
			event.preventDefault();
			event.stopPropagation();
			let maxLen = columnId.length;
			for (const item of indexedRows.slice(0, 100)) {
				const val = item.row[columnId];
				if (val != null && val.length > maxLen) {
					maxLen = Math.min(val.length, 50);
				}
			}
			const estimatedWidth = Math.min(
				MAX_COLUMN_WIDTH_PX,
				Math.max(MIN_COLUMN_WIDTH_PX, Math.round(maxLen * 8.5 + 32)),
			);
			setColumnWidths((prev) => ({ ...prev, [columnId]: estimatedWidth }));
		},
		[indexedRows],
	);

	const renderBodyCell = useCallback(
		(cell: Cell<ResultRow, unknown>) => {
			const cellDef = cell.column.columnDef.cell;
			if (cellDef) {
				return flexRender(cellDef, cell.getContext());
			}
			return formatValue(cell.getValue() as string | null);
		},
		[],
	);

	const hasEdits = Object.keys(pendingEdits).length > 0 || editingCell !== null;

	useEffect(() => {
		setColumnWidths((previous) => {
			const identifiers = ["__select", "__rowNumber", ...columns];
			const next: Record<string, number> = {};
			for (const id of identifiers) {
				const fallback =
					id === "__select"
						? SELECT_COLUMN_WIDTH_PX
						: id === "__rowNumber"
							? ROW_NUMBER_COLUMN_WIDTH_PX
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
		setSorting([]);
		setGlobalFilter("");
		setInspectedCell(null);
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
			setGridError(t("editor.insertNoColumns"));
		}
	}, [insertRowTrigger, canInsertRow, columns.length, t]);

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
			setGridError(saveDisabledReason ?? t("editor.editingDisabled"));
			return;
		}

		let edits = pendingEdits;
		if (editingCell) {
			const activeElement = document.activeElement;
			if (
				activeElement instanceof HTMLInputElement ||
				activeElement instanceof HTMLTextAreaElement
			) {
				const originalValue =
					originalByRowId[editingCell.rowId]?.[editingCell.columnId] ?? null;
				edits = mergePendingEdit(
					edits,
					editingCell.rowId,
					editingCell.columnId,
					activeElement.value,
					originalValue,
				);
			}
			if (activeElement instanceof HTMLElement) {
				activeElement.blur();
			}
			setEditingCell(null);
			setPendingEdits(edits);
		}

		const patches: ResultEditPatch[] = Object.entries(edits)
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
			setGridError(t("editor.noEditableChanges"));
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

	const exportColumns = useMemo(
		() =>
			visibleColumns
				.filter((column) => column.id !== "__select" && column.id !== "__rowNumber")
				.map((column) => column.id),
		[visibleColumns],
	);

	const handleCopy = async () => {
		const selectedRows = getRowsForAction();
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

	const handleCopyMarkdown = async () => {
		const selectedRows = getRowsForAction();
		if (exportColumns.length === 0) {
			setGridError(t("editor.noVisibleColumnsToCopy"));
			return;
		}

		setGridError(null);
		try {
			await copyRowsAsMarkdown(exportColumns, selectedRows);
		} catch (error) {
			const message =
				error instanceof Error ? error.message : "Failed to copy as Markdown.";
			setGridError(message);
		}
	};

	const handleCopySqlInsert = async () => {
		const selectedRows = getRowsForAction();
		if (exportColumns.length === 0) {
			setGridError(t("editor.noVisibleColumnsToCopy"));
			return;
		}

		const tableName = insertTable
			? insertTable.schema
				? `"${insertTable.schema}"."${insertTable.name}"`
				: `"${insertTable.name}"`
			: "query_results";

		setGridError(null);
		try {
			await copyRowsAsSqlInsert(tableName, exportColumns, selectedRows);
		} catch (error) {
			const message =
				error instanceof Error ? error.message : "Failed to copy as SQL INSERT.";
			setGridError(message);
		}
	};

	const handleDownloadCsv = async () => {
		if (exportColumns.length === 0) {
			setGridError(t("editor.noVisibleColumnsToExport"));
			return;
		}

		setGridError(null);
		try {
			await downloadRowsAsCsv("query-results.csv", exportColumns, getRowsForAction());
		} catch (error) {
			const message =
				error instanceof Error ? error.message : t("editor.failedToDownloadCsv");
			setGridError(message);
			notifyError(error, { title: "CSV export failed", category: "internal" });
		}
	};

	const handleDownloadJson = async () => {
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
			setGridError(
				t("editor.requiredValuesMissing", { fields: missing.join(", ") }),
			);
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
			const message =
				error instanceof Error ? error.message : t("editor.insertFailed");
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
	const filteredRowsCount = table.getRowModel().rows.filter((r) => r.id !== "__insert__").length;
	const totalDataRowsCount = result?.rowCount ?? 0;

	if (isPending) {
		return renderLoadingSkeleton();
	}

	return (
		<div className="flex h-full min-w-0 flex-col overflow-hidden">
			<ResultsToolbar
				columns={table.getAllLeafColumns().map((column) => ({
					id: column.id,
					label:
						column.id === "__select"
							? "Select"
							: column.id === "__rowNumber"
								? "#"
								: column.id,
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
				onCopyMarkdown={() => {
					void handleCopyMarkdown();
				}}
				onCopySqlInsert={() => {
					void handleCopySqlInsert();
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
				onInsertRow={insertRowVisible ? () => void handleInsertRow() : undefined}
				onCancelInsert={insertRowVisible ? handleCancelInsert : undefined}
				insertBusy={insertMutation.isPending}
				insertDisabled={insertDisabled}
				selectionCount={Object.keys(rowSelection).length}
				onDeleteRows={onDeleteRows ? () => void handleDeleteRows() : undefined}
				deleteBusy={deleteBusy}
				onCreateChart={onCreateChart}
				canCreateChart={canCreateChart}
				deleteDisabledReason={
					!canEdit
						? saveDisabledReason
						: Object.keys(rowSelection).length === 0
							? t("editor.selectRowsToDelete")
							: undefined
				}
				filterQuery={globalFilter}
				onFilterQueryChange={setGlobalFilter}
				filterMatchCount={filteredRowsCount}
				totalRowCount={totalDataRowsCount}
				filterInputRef={filterInputRef}
				isInspectorOpen={isInspectorOpen}
				onToggleInspector={() => setIsInspectorOpen((prev) => !prev)}
			/>

			{hasRowset ? (
				<div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
					<ContextMenu onOpenChange={(open) => { if (!open) setContextMenuTarget(null); }}>
						<ContextMenuTrigger asChild>
							<div
								ref={parentRef}
								role="grid"
								aria-rowcount={tableRows.length + 1}
								aria-colcount={visibleColumns.length}
								className="relative min-h-0 min-w-0 flex-1 overflow-auto overscroll-contain"
							>
								<div
									className="relative min-w-full"
									style={{ width: `${totalGridWidthPx}px` }}
								>
									{/* Column headers: sticky, with an opaque base so rows never show through. */}
									<div role="rowgroup" className="sticky top-0 z-20 bg-background">
										<div
											role="row"
											className="flex min-w-full overflow-hidden border-b border-border bg-muted/50"
											style={{ height: `${rowHeightPx}px` }}
										>
											{selectColumn ? (
												<div
													role="columnheader"
													className="flex flex-none items-center justify-center border-r border-border"
													style={{ width: `${selectColumnWidthPx}px` }}
												>
													<SelectAllCheckbox
														checked={table.getIsAllRowsSelected()}
														indeterminate={
															!table.getIsAllRowsSelected() &&
															table.getIsSomeRowsSelected()
														}
														disabled={indexedRows.length === 0}
														label={t("editor.selectAllRows")}
														onChange={table.getToggleAllRowsSelectedHandler()}
													/>
												</div>
											) : null}

											{rowNumberColumn ? (
												<div
													role="columnheader"
													className="flex flex-none select-none items-center justify-center border-r border-border px-2 text-[11px] font-medium text-muted-foreground"
													style={{ width: `${rowNumberColumnWidthPx}px` }}
												>
													<span>#</span>
												</div>
											) : null}

											{virtualPaddingLeft > 0 ? (
												<div
													aria-hidden
													className="flex-none"
													style={{ width: `${virtualPaddingLeft}px` }}
												/>
											) : null}

											{virtualDataColumns.map((virtualColumn) => {
												const column = dataVisibleColumns[virtualColumn.index];
												if (!column) {
													return null;
												}
												const widthPx = getColumnWidthPx(column.id);
												const isSorted = column.getIsSorted();
												const sortIndex = column.getSortIndex();
												const isPrimaryKey = primaryKeyColumnsByLower.has(
													normalizeColumnId(column.id),
												);
												const colMeta = metaByLowerName.get(
													normalizeColumnId(column.id),
												);

												return (
													<div
														key={column.id}
														role="columnheader"
														aria-sort={
															isSorted === "asc"
																? "ascending"
																: isSorted === "desc"
																	? "descending"
																	: undefined
														}
														onClick={column.getToggleSortingHandler()}
														className="group relative flex flex-none cursor-pointer select-none items-center justify-between border-r border-border px-3 pr-2 text-[11px] font-medium text-muted-foreground hover:bg-muted/60 hover:text-foreground"
														style={{ width: `${widthPx}px` }}
														title="Click to sort (Shift+Click for multi-sort)"
													>
														<div className="flex min-w-0 items-center gap-1.5">
															{isPrimaryKey ? (
																<span title="Primary Key" className="inline-flex shrink-0">
																	<KeyIcon className="size-3 text-amber-500" />
																</span>
															) : null}
															<span className="truncate">{column.id}</span>
															{colMeta?.dataType ? (
																<span className="shrink-0 rounded-xs bg-muted/60 px-1 font-mono text-[9px] uppercase tracking-wider text-muted-foreground/70 select-none">
																	{colMeta.dataType}
																</span>
															) : null}
														</div>
														<div className="ml-1 flex shrink-0 items-center gap-0.5">
															{isSorted === "asc" ? (
																<CaretUpIcon className="size-3 text-primary" />
															) : isSorted === "desc" ? (
																<CaretDownIcon className="size-3 text-primary" />
															) : (
																<ArrowsDownUpIcon className="size-2.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-60" />
															)}
															{table.getState().sorting.length > 1 && isSorted ? (
																<span className="rounded-xs bg-muted px-1 font-mono text-[9px] text-muted-foreground">
																	{sortIndex + 1}
																</span>
															) : null}
														</div>
														<div
															role="separator"
															aria-orientation="vertical"
															aria-label={t("editor.resizeColumn", { name: column.id })}
															title="Drag to resize, double-click to auto-fit"
															className="absolute -right-1 top-0 z-10 flex h-full w-2 cursor-col-resize touch-none select-none justify-center after:h-full after:w-0.5 after:bg-transparent after:transition-colors hover:after:bg-[var(--control-accent)]"
															// Finishing a drag fires a click on the header; don't let it toggle sorting.
															onClick={(event) => event.stopPropagation()}
															onDoubleClick={(event) =>
																handleColumnAutoFit(column.id, event)
															}
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
													className="flex-none"
													style={{ width: `${virtualPaddingRight}px` }}
												/>
											) : null}
										</div>
									</div>

									{/* Body rows */}
									<div
										role="rowgroup"
										className="relative"
										style={{ height: `${rowVirtualizer.getTotalSize()}px` }}
									>
										{rowVirtualizer.getVirtualItems().map((virtualRow) => {
											const row = tableRows[virtualRow.index];
											if (!row) {
												return null;
											}

											const isInsert = row.id === "__insert__";
											const isSelected = row.getIsSelected();
											const rowCells = row.getVisibleCells();
											const rowCellByColumn = new Map(
												rowCells.map((cell) => [cell.column.id, cell]),
											);
											const selectCell = selectColumn
												? rowCellByColumn.get(selectColumn.id)
												: undefined;
											const rowNumberCell = rowNumberColumn
												? rowCellByColumn.get(rowNumberColumn.id)
												: undefined;

											return (
												<div
													key={row.id}
													role="row"
													aria-selected={isSelected || undefined}
													className={cn(
														"absolute left-0 top-0 flex w-full border-b border-border/60 text-xs",
														isInsert
															? "bg-muted/40"
															: isSelected
																? "bg-[var(--control-accent-muted)]"
																: virtualRow.index % 2 === 1
																	? "bg-muted/20 hover:bg-muted/45"
																	: "hover:bg-muted/45",
													)}
													style={{
														height: `${virtualRow.size}px`,
														transform: `translateY(${virtualRow.start}px)`,
													}}
												>
													{selectCell ? (
														<div
															role="gridcell"
															className="flex flex-none items-center justify-center border-r border-border/60"
															style={{ width: `${selectColumnWidthPx}px` }}
														>
															{renderBodyCell(selectCell)}
														</div>
													) : null}

													{rowNumberCell ? (
														<div
															role="gridcell"
															className="flex flex-none items-center justify-center border-r border-border/60 px-2"
															style={{ width: `${rowNumberColumnWidthPx}px` }}
														>
															{renderBodyCell(rowNumberCell)}
														</div>
													) : null}

													{virtualPaddingLeft > 0 ? (
														<div
															aria-hidden
															className="flex-none"
															style={{ width: `${virtualPaddingLeft}px` }}
														/>
													) : null}

													{virtualDataColumns.map((virtualColumn) => {
														const column = dataVisibleColumns[virtualColumn.index];
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
														const isInspected =
															inspectedCell?.rowId === row.id &&
															inspectedCell?.columnId === column.id;
														const isCellEditing =
															editingCell?.rowId === row.id &&
															editingCell.columnId === column.id;
														const isCopied = copiedCellId === cell.id;
														const copyEnabled = clickToCopy && !isCellEditing && !isInsert;

														return (
															<div
																key={cell.id}
																role="gridcell"
																className={cn(
																	"flex flex-none items-center overflow-hidden border-r border-border/60 px-3",
																	copyEnabled &&
																		"cursor-copy hover:bg-accent/40 active:bg-accent/60",
																	isCopied &&
																		"bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
																	isInspected &&
																		"bg-primary/5 ring-1 ring-inset ring-primary/50",
																)}
																style={{ width: `${widthPx}px` }}
																title={
																	isInsert
																		? undefined
																		: `${formatValue(cellValue)}${
																				isCopied
																					? " — Copied!"
																					: copyEnabled
																						? "\nClick to copy"
																						: ""
																			}`
																}
																onClick={() => {
																	// Insert-row cells hold inputs; clicks there are for typing.
																	if (isCellEditing || isInsert) return;
																	if (isInspectorOpen) {
																		setInspectedCell({
																			rowId: row.id,
																			columnId: column.id,
																			value: cellValue,
																			rowIndex: virtualRow.index,
																		});
																	}
																	if (!copyEnabled) return;
																	const text = formatValue(cellValue);
																	if (!text) return;
																	void navigator.clipboard.writeText(text);
																	setCopiedCellId(cell.id);
																	if (copyTimeoutRef.current)
																		clearTimeout(copyTimeoutRef.current);
																	copyTimeoutRef.current = window.setTimeout(
																		() => setCopiedCellId(null),
																		1200,
																	);
																}}
																onDoubleClick={() => {
																	if (isCellEditing || isInsert) return;
																	setInspectedCell({
																		rowId: row.id,
																		columnId: column.id,
																		value: cellValue,
																		rowIndex: virtualRow.index,
																	});
																	setIsInspectorOpen(true);
																}}
																onContextMenu={() => {
																	const target = {
																		rowId: row.id,
																		columnId: column.id,
																		value: cellValue,
																		rowIndex: virtualRow.index,
																		row: row.original,
																	};
																	contextMenuTargetRef.current = target;
																	setContextMenuTarget(target);
																}}
															>
																<div className="min-w-0 flex-1">{renderBodyCell(cell)}</div>
															</div>
														);
													})}

													{virtualPaddingRight > 0 ? (
														<div
															aria-hidden
															className="flex-none"
															style={{ width: `${virtualPaddingRight}px` }}
														/>
													) : null}
												</div>
											);
										})}
									</div>
								</div>
							</div>
						</ContextMenuTrigger>

						{/* Context Menu */}
						<ContextMenuContent>
							{(() => {
								const target = contextMenuTarget ?? contextMenuTargetRef.current;
								if (target) {
									return (
										<>
											<ContextMenuItem
												onClick={() => {
													const val = formatValue(target.value);
													if (val) void navigator.clipboard.writeText(val);
												}}
											>
												<CopyIcon className="size-3.5 text-muted-foreground" />
												<span>{t("editor.copyCellValue", "Copy Cell Value")}</span>
											</ContextMenuItem>

											<ContextMenuItem
												onClick={() => {
													if (target.value === null) return;
													setGlobalFilter(target.value);
												}}
											>
												<MagnifyingGlassIcon className="size-3.5 text-muted-foreground" />
												<span>{t("editor.filterByValue", "Filter by This Value")}</span>
											</ContextMenuItem>

											<ContextMenuItem
												onClick={() => {
													setInspectedCell({
														rowId: target.rowId,
														columnId: target.columnId,
														value: target.value,
														rowIndex: target.rowIndex,
													});
													setIsInspectorOpen(true);
												}}
											>
												<SidebarSimpleIcon className="size-3.5 text-muted-foreground" />
												<span>{t("editor.inspectCell", "Inspect in Cell Drawer")}</span>
											</ContextMenuItem>

											<ContextMenuSeparator />

											<ContextMenuItem
												onClick={() => {
													void copyRows(exportColumns, [target.row]);
												}}
											>
												<span>{t("editor.copyRowTsv", "Copy Row (TSV)")}</span>
											</ContextMenuItem>

											<ContextMenuItem
												onClick={() => {
													void copyRowsAsMarkdown(exportColumns, [target.row]);
												}}
											>
												<span>{t("editor.copyRowMarkdown", "Copy Row as Markdown")}</span>
											</ContextMenuItem>

											<ContextMenuItem
												onClick={() => {
													const tableName = insertTable
														? insertTable.schema
															? `"${insertTable.schema}"."${insertTable.name}"`
															: `"${insertTable.name}"`
														: "query_results";
													void copyRowsAsSqlInsert(tableName, exportColumns, [target.row]);
												}}
											>
												<span>{t("editor.copyRowSql", "Copy Row as SQL INSERT")}</span>
											</ContextMenuItem>

											<ContextMenuItem
												onClick={() => {
													const obj: Record<string, string | null> = {};
													for (const col of exportColumns) {
														obj[col] = target.row[col] ?? null;
													}
													void navigator.clipboard.writeText(JSON.stringify(obj, null, 2));
												}}
											>
												<span>{t("editor.copyRowJson", "Copy Row as JSON")}</span>
											</ContextMenuItem>

											{canEdit ? (
												<>
													<ContextMenuSeparator />
													<ContextMenuItem
														onClick={() => {
															const normalized = normalizeColumnId(target.columnId);
															if (
																editableColumnsByLower.has(normalized) &&
																!primaryKeyColumnsByLower.has(normalized)
															) {
																applyPendingEdit(target.rowId, target.columnId, "");
															}
														}}
													>
														<span>{t("editor.setToNull", "Set Cell to NULL")}</span>
													</ContextMenuItem>
												</>
											) : null}

											{onDeleteRows ? (
												<>
													<ContextMenuSeparator />
													<ContextMenuItem
														variant="destructive"
														onClick={() => {
															const source = indexedRows.find((r) => r.rowId === target.rowId);
															if (source?.hasCompletePrimaryKey) {
																void onDeleteRows([source.primaryKey]);
															}
														}}
													>
														<TrashIcon className="size-3.5" />
														<span>{t("editor.deleteRow", "Delete Row")}</span>
													</ContextMenuItem>
												</>
											) : null}
										</>
									);
								}

								return (
									<>
										<ContextMenuItem onClick={() => void handleCopy()}>
											<span>{t("editor.copy", "Copy Rows (TSV)")}</span>
										</ContextMenuItem>
										<ContextMenuItem onClick={() => void handleCopyMarkdown()}>
											<span>{t("editor.copyMarkdown", "Copy as Markdown")}</span>
										</ContextMenuItem>
										<ContextMenuItem onClick={() => void handleCopySqlInsert()}>
											<span>{t("editor.copySqlInsert", "Copy as SQL INSERT")}</span>
										</ContextMenuItem>
									</>
								);
							})()}
						</ContextMenuContent>
					</ContextMenu>

					{/* Cell Inspector Drawer */}
					<CellInspectorDrawer
						cell={inspectedCell}
						isOpen={isInspectorOpen}
						onClose={() => setIsInspectorOpen(false)}
						canEdit={
							canEdit &&
							Boolean(
								inspectedCell &&
									editableColumnsByLower.has(normalizeColumnId(inspectedCell.columnId)) &&
									!primaryKeyColumnsByLower.has(normalizeColumnId(inspectedCell.columnId)),
							)
						}
						onSaveEdit={(rowId, columnId, newValue) =>
							applyPendingEdit(rowId, columnId, newValue)
						}
						isSaving={isSaving}
					/>
				</div>
			) : (
				<div className="flex min-h-0 min-w-0 flex-1 flex-col items-center justify-center gap-2 px-4 text-center text-xs text-muted-foreground">
					{result == null ? (
						<>
							<span>{t("editor.runQueryToSeeResults")}</span>
							{canInsertRow ? (
								<span className="max-w-md">{t("editor.addRowHint")}</span>
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
								<span className="max-w-md">{t("editor.inlineAddRowHint")}</span>
							) : null}
						</>
					)}
				</div>
			)}

			{/* Status Bar */}
			<div className="flex items-center justify-between border-t border-border bg-muted/10 px-3 py-1.5 text-[11px] text-muted-foreground">
				<div>
					{saveDisabledReason && !canEdit
						? saveDisabledReason
						: t("editor.rowsSelected", { count: Object.keys(rowSelection).length })}
				</div>
				{result ? (
					<div className="flex items-center gap-3 font-mono text-[10px]">
						{globalFilter ? (
							<span>
								Filtered: {filteredRowsCount} of {result.rowCount} rows
							</span>
						) : (
							<span>{result.rowCount} rows</span>
						)}
						<span>⚡ {result.executionMs} ms</span>
						{sorting.length > 0 ? (
							<button
								type="button"
								onClick={() => setSorting([])}
								className="text-muted-foreground hover:text-foreground underline decoration-dotted cursor-pointer"
								title="Reset column sorting"
							>
								Sorted ({sorting.length}) [Reset]
							</button>
						) : null}
					</div>
				) : null}
			</div>

			{gridError ? (
				<div className="border-t border-border bg-destructive/10 px-3 py-1.5 text-[11px] text-destructive">
					{gridError}
				</div>
			) : null}
			<JsonCellDialog
				value={jsonView?.value ?? null}
				onApply={
					jsonView?.editable
						? (next) =>
								applyPendingEdit(jsonView.rowId, jsonView.columnId, next)
						: undefined
				}
				onOpenChange={(open) => {
					if (!open) setJsonView(null);
				}}
			/>
		</div>
	);
}
