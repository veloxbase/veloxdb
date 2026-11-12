import {
	CaretDownIcon,
	DatabaseIcon,
	DotsThreeIcon,
	FloppyDiskIcon,
	LightningIcon,
	PlayIcon,
	PlusIcon,
	TextHIcon,
	XIcon,
} from "@phosphor-icons/react";
import { useQueryClient, type UseMutationResult } from "@tanstack/react-query";
import {
	forwardRef,
	type PointerEvent as ReactPointerEvent,
	useCallback,
	useEffect,
	useImperativeHandle,
	useMemo,
	useReducer,
	useRef,
	useState,
} from "react";
import { useTranslation } from "react-i18next";
import { format } from "sql-formatter";

import { ErrorBoundary } from "@/components/ErrorBoundary";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { DatabaseEngine, TableInfo } from "@/data/types";
import { queryKeys } from "@/data/query-keys";
import { canUseDashboards } from "@/features/dashboards/engine-guard";
import { QueryHistoryPanel } from "@/features/queries/components/QueryHistoryPanel";
import { ResultsGrid } from "@/features/queries/components/ResultsGrid";
import { SqlEditor } from "@/features/queries/components/SqlEditor";
import {
	useExplainPlanMutation,
	useLintSqlMutation,
	useQueryEditorMetadata,
	useRunQueryMutation,
} from "@/features/queries/queries";
import {
	toPersistedSnapshot,
	writePersistedQueryWorkspace,
} from "@/features/queries/query-workspace-persistence";
import { getShortcutDisplay } from "@/lib/shortcuts/registry";
import { useAppHotkey } from "@/lib/shortcuts/use-app-hotkey";
import {
	getFocusedTabId,
	loadQueryWorkspaceInitialState,
	type QueryHistoryEntry,
	type QueryTabModel,
	type QueryWorkspaceState,
	queryWorkspaceReducer,
} from "@/features/queries/query-workspace-state";
import type {
	ResultEditPatch,
	SaveResultEditsRequest,
} from "@/features/queries/result-edits";
import { notifyError, notifySuccess } from "@/lib/error-notifier";
import { isReadOnlySql } from "@/lib/sql-intent";
import { cn } from "@/lib/utils";

const MIN_QUERY_HEIGHT = 180;
const MIN_RESULTS_HEIGHT = 160;

type SaveMutation = UseMutationResult<
	void,
	unknown,
	SaveResultEditsRequest,
	unknown
>;

export type QueryWorkspaceHandle = {
	applyTablePreview: (sql: string) => void;
	/** Replace editor SQL without executing (binds active connection when set). */
	replaceQuerySql: (sql: string) => void;
	/** Append SQL to the editor without executing (binds active connection when set). */
	appendQuerySql: (sql: string) => void;
	openTabWithSql: (sql: string) => void;
	openTabWithSqlAndRun: (sql: string) => void;
	runLastQuery: () => void;
	refreshFocusedResults: () => void;
	getHasLastQuery: () => boolean;
	/** Keep the active query tab aligned with the connection chosen in the sidebar. */
	setActiveTabConnection: (connectionId: string | null) => void;
	/** Clear a removed saved connection from all tabs so IPC targets stay valid. */
	detachDeletedConnection: (connectionId: string) => void;
	toggleAskVeloxy: () => void;
	/** Current SQL in the focused tab (unexecuted edits included). Used by "Save Query". */
	getActiveTabSql: () => string | null;
	/** Saved connection bound to the focused tab, if any. Used by "Save Query". */
	getActiveTabConnectionId: () => string | null;
	/** Last executed SQL in the focused tab, if any. Used by "Create chart". */
	getActiveTabLastExecutedSql: () => string | null;
};

type QueryWorkspaceProps = {
	connectionId: string | null;
	connectionEngine: DatabaseEngine | null;
	connectionError: unknown;
	connectionErrorMessage: string;
	isDark: boolean;
	onRequestConnection: () => void;
	resultsHeight: number;
	onResultsHeightChange: (height: number) => void;
	selectedTable: TableInfo | null;
	schemaLoading: boolean;
	schemaError: string | null;
	columnCount: number | null;
	primaryKeyColumns: string[];
	editableColumns: string[];
	saveDisabledReason: string | undefined;
	isResultSingleTableEditable: boolean;
	saveResultEditsMutation: SaveMutation;
	onSaveResultEdits: (patches: ResultEditPatch[]) => Promise<void>;
	onDeleteRows?: (
		primaryKeys: Record<string, string | null>[],
	) => Promise<void>;
	onFocusedTabCapabilitiesChange?: (caps: {
		hasLastQuery: boolean;
		hasResult: boolean;
	}) => void;
	/** When switching to a tab that targets another saved connection, activate it in the shell. */
	onActivateConnectionForTab?: (connectionId: string) => void;
	/** Request inline insert row in results grid (increments trigger in shell). */
	onOpenAddRow?: () => void;
	insertRowTrigger: number;
	insertConnectionId: string | null;
	insertTable: TableInfo | null;
	canInsertRow: boolean;
	onInsertRowSuccess: () => void;
	onFixQueryError?: (sql: string, errorMessage: string) => void;
	onToggleAskVeloxy?: () => void;
	isVeloxyOpen?: boolean;
	/** Pro-only: opens the Save Query dialog for the focused tab's SQL. Hidden when omitted. */
	onSaveQuery?: () => void;
	/** Pro-only: opens the Chart Builder for the focused tab's last executed SQL. Hidden when omitted. */
	onCreateChart?: (sql: string, connectionId: string) => void;
};

function buildPersistSnapshot(state: QueryWorkspaceState) {
	const tabs: Record<
		string,
		{
			title: string;
			sql: string;
			lastExecutedSql: string;
			connectionId?: string | null;
		}
	> = {};
	for (const id of state.tabOrder) {
		const t = state.tabs[id];
		if (t) {
			tabs[id] = {
				title: t.title,
				sql: t.sql,
				lastExecutedSql: t.lastExecutedSql,
				connectionId: t.connectionId,
			};
		}
	}
	return toPersistedSnapshot({
		tabOrder: state.tabOrder,
		tabs,
		activeTabId: state.activeTabId,
		queryHistoryByConnection: state.queryHistoryByConnection,
	});
}

type QueryPaneProps = {
	tab: QueryTabModel;
	connectionEngine: DatabaseEngine | null;
	isDark: boolean;
	onSqlChange: (sql: string) => void;
	onRun: () => void;
	onRunStatement: (sql: string) => void;
	onResultsSubTabChange: (value: "results" | "plan") => void;
	editorMetadata: ReturnType<typeof useQueryEditorMetadata>["data"];
	lintDiagnostics: {
		message: string;
		severity: "error" | "warning" | "info";
		line?: number | null;
		column?: number | null;
		endLine?: number | null;
		endColumn?: number | null;
	}[];
	resultsHeight: number;
	onResultsResizeStart: (event: ReactPointerEvent<HTMLDivElement>) => void;
	selectedTable: TableInfo | null;
	schemaLoading: boolean;
	schemaError: string | null;
	columnCount: number | null;
	saveDisabledReason: string | undefined;
	isResultSingleTableEditable: boolean;
	editableColumns: string[];
	primaryKeyColumns: string[];
	saveResultEditsMutation: SaveMutation;
	onSaveResultEdits: (patches: ResultEditPatch[]) => Promise<void>;
	onDeleteRows?: (
		primaryKeys: Record<string, string | null>[],
	) => Promise<void>;
	onRefreshResults: () => void;
	onRefreshPlan: () => void;
	connectionError: unknown;
	connectionErrorMessage: string;
	onAddRow?: () => void;
	insertRowTrigger: number;
	insertConnectionId: string | null;
	insertTable: TableInfo | null;
	canInsertRow: boolean;
	onInsertRowSuccess: () => void;
	onFixQueryError?: (sql: string, errorMessage: string) => void;
	/** Pro-only: opens the Chart Builder for the focused tab's last executed SQL. Hidden when omitted. */
	onCreateChart?: (sql: string, connectionId: string) => void;
};

function QueryPane({
	tab,
	connectionEngine,
	isDark,
	onSqlChange,
	onRun,
	onRunStatement,
	onResultsSubTabChange,
	editorMetadata,
	lintDiagnostics,
	resultsHeight,
	onResultsResizeStart,
	selectedTable,
	schemaLoading,
	schemaError,
	columnCount,
	saveDisabledReason,
	isResultSingleTableEditable,
	editableColumns,
	primaryKeyColumns,
	saveResultEditsMutation,
	onSaveResultEdits,
	onDeleteRows,
	onRefreshResults,
	onRefreshPlan,
	connectionError,
	connectionErrorMessage,
	onAddRow,
	insertRowTrigger,
	insertConnectionId,
	insertTable,
	canInsertRow,
	onInsertRowSuccess,
	onFixQueryError,
	onCreateChart,
}: QueryPaneProps) {
	const { t } = useTranslation()
	const resultsTab = tab.resultsSubTab;
	const runPending = tab.runInFlight;
	const explainPending = tab.explainInFlight;
	const canCreateChart = Boolean(
		tab.connectionId
		&& tab.lastExecutedSql.trim()
		&& tab.queryResult
		&& connectionEngine
		&& canUseDashboards(connectionEngine),
	);

	return (
		<section
			className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden outline-none"
						aria-label={t("editor.queryEditor")}
		>
			<section className="relative z-0 min-h-0 min-w-0 flex-1 overflow-hidden">
				<SqlEditor
					value={tab.sql}
					isDark={isDark}
					onChange={onSqlChange}
					onRun={onRun}
					onRunStatement={onRunStatement}
					language={connectionEngine ?? "sql"}
					metadata={editorMetadata}
					diagnostics={lintDiagnostics}
					connectionEngine={connectionEngine}
				/>
			</section>

			<div
				className="relative z-20 h-1 shrink-0 cursor-row-resize border-y border-border bg-muted/10 hover:bg-muted/30"
				onPointerDown={onResultsResizeStart}
						title={t("editor.resizeResults")}
			/>

			<section
				className="relative z-10 min-h-0 min-w-0 shrink-0 overflow-hidden bg-background isolate"
				style={{ height: `${resultsHeight}px` }}
			>
				<Tabs
					value={resultsTab}
					onValueChange={(v) => onResultsSubTabChange(v as "results" | "plan")}
					className="flex h-full min-h-0 flex-col"
				>
					<div className="min-w-0 shrink-0 overflow-x-auto border-b border-border">
						<div className="flex min-w-full w-max flex-col gap-2 px-4 py-2 sm:flex-row sm:items-center sm:justify-between">
							<div className="min-w-0 flex-1">
								<TabsList variant="line" className="h-8">
									<TabsTrigger value="results" className="text-xs">
										{t("editor.resultsTab")}
									</TabsTrigger>
									<TabsTrigger value="plan" className="text-xs">
										{t("editor.explainPlanTab")}
									</TabsTrigger>
								</TabsList>
								<p className="mt-1 truncate text-sm text-foreground">
									{resultsTab === "plan"
										? connectionEngine === "mysql"
											? t("editor.explainOutput")
											: connectionEngine === "sqlite"
												? t("editor.explainQueryPlanOutput")
												: t("editor.explainAnalyzeOutput")
										: selectedTable
											? `${selectedTable.schema}.${selectedTable.name}`
											: t("editor.currentQueryOutput")}
								</p>
							</div>

							<div className="shrink-0 text-right text-xs text-muted-foreground whitespace-nowrap">
								{resultsTab === "plan" ? (
									<span>
										{tab.planResult
											? t("editor.planLinesIn", { count: tab.planResult.rowCount, time: tab.planResult.executionMs })
											: explainPending
												? t("editor.runningExplain")
												: connectionEngine === "postgres"
													? t("editor.runExplainAnalyzeFromToolbar")
													: t("editor.runExplainFromToolbar")}
									</span>
								) : tab.queryResult ? (
									<span
										key={`${tab.runFlightId}-${tab.queryResult.executionMs}-${tab.queryResult.rowCount}`}
										className="inline-block animate-metric-influx"
									>
										{t("editor.rowsIn", { count: tab.queryResult.rowCount, time: tab.queryResult.executionMs })}
										{columnCount != null
											? ` · ${t("editor.columnsInSelectedTable", { count: columnCount })}`
											: ""}
									</span>
								) : schemaLoading ? (
									<span>{t("editor.loadingColumns")}</span>
								) : schemaError ? (
									<span className="text-destructive">{schemaError}</span>
								) : columnCount != null ? (
									<span>{t("editor.columnsInSelectedTable", { count: columnCount })}</span>
								) : (
									<span>{t("editor.noQueryExecutedYet")}</span>
								)}
							</div>
						</div>
					</div>

					<TabsContent
						value="results"
						className="m-0 min-h-0 flex-1 overflow-hidden data-[state=inactive]:hidden"
					>
						<ErrorBoundary
							fallback={
								<div className="flex h-full items-center justify-center p-4 text-xs text-destructive">
									Results failed to render.
								</div>
							}
						>
							<ResultsGrid
								result={tab.queryResult}
								isPending={runPending}
								isSaving={saveResultEditsMutation.isPending}
								canEdit={isResultSingleTableEditable}
								editableColumns={editableColumns}
								primaryKeyColumns={primaryKeyColumns}
								saveDisabledReason={saveDisabledReason}
							onRefresh={onRefreshResults}
							onSaveEdits={onSaveResultEdits}
							onDeleteRows={onDeleteRows}
							onAddRow={onAddRow}
							insertRowTrigger={insertRowTrigger}
							insertConnectionId={insertConnectionId}
							insertTable={insertTable}
							canInsertRow={canInsertRow}
							onInsertRowSuccess={onInsertRowSuccess}
							onCreateChart={onCreateChart && tab.connectionId
								? () => onCreateChart(tab.lastExecutedSql, tab.connectionId as string)
								: undefined}
							canCreateChart={canCreateChart}
						/>
					</ErrorBoundary>
				</TabsContent>

				<TabsContent
					value="plan"
						className="m-0 min-h-0 flex-1 overflow-hidden data-[state=inactive]:hidden"
					>
						<ErrorBoundary
							fallback={
								<div className="flex h-full items-center justify-center p-4 text-xs text-destructive">
									Explain output failed to render.
								</div>
							}
						>
							<ResultsGrid
								result={tab.planResult}
								isPending={explainPending}
								isSaving={false}
								canEdit={false}
								editableColumns={[]}
								primaryKeyColumns={[]}
								saveDisabledReason={t("editor.editingNotAvailableForExplain")}
								onRefresh={onRefreshPlan}
								onSaveEdits={async () => {}}
								insertRowTrigger={0}
								insertConnectionId={null}
								insertTable={null}
								canInsertRow={false}
								onInsertRowSuccess={() => {}}
							/>
						</ErrorBoundary>
					</TabsContent>
				</Tabs>

				{(resultsTab === "results" && tab.queryResult?.truncated) ||
				(resultsTab === "plan" && tab.planResult?.truncated) ? (
					<div className="border-t border-border bg-muted/20 px-4 py-2 text-xs text-muted-foreground">
						{t("editor.outputTruncated")}
					</div>
				) : null}

				{connectionError ? (
					<div className="border-t border-border bg-destructive/10 px-4 py-2 text-xs text-destructive">
						{connectionErrorMessage}
					</div>
				) : null}

				{tab.runError ? (
					<div className="flex flex-wrap items-start justify-between gap-3 border-t border-border bg-destructive/10 px-4 py-2.5 text-xs text-destructive">
						<div className="min-w-0 flex-1 font-mono whitespace-pre-wrap">
							{tab.runError}
						</div>
						{onFixQueryError ? (
							<Button
								type="button"
								variant="outline"
								size="sm"
								className="h-7 shrink-0 gap-1.5 border-destructive/40 bg-background/80 text-[11px] font-medium text-destructive shadow-none hover:bg-destructive/10 hover:text-destructive"
								onClick={() => onFixQueryError(tab.sql, tab.runError || "")}
							>
								<LightningIcon className="size-3.5 fill-current" />
								<span>{t("shortcuts.fixQueryError", "Fix with Veloxy")}</span>
								<kbd className="rounded border border-destructive/30 bg-muted/50 px-1 py-0.2 text-[9px] font-mono">
									{getShortcutDisplay("fixQueryError")}
								</kbd>
							</Button>
						) : null}
					</div>
				) : null}

				{tab.planError ? (
					<div className="flex flex-wrap items-start justify-between gap-3 border-t border-border bg-destructive/10 px-4 py-2.5 text-xs text-destructive">
						<div className="min-w-0 flex-1 font-mono whitespace-pre-wrap">
							{tab.planError}
						</div>
						{onFixQueryError ? (
							<Button
								type="button"
								variant="outline"
								size="sm"
								className="h-7 shrink-0 gap-1.5 border-destructive/40 bg-background/80 text-[11px] font-medium text-destructive shadow-none hover:bg-destructive/10 hover:text-destructive"
								onClick={() => onFixQueryError(tab.sql, tab.planError || "")}
							>
								<LightningIcon className="size-3.5 fill-current" />
								<span>{t("shortcuts.fixQueryError", "Fix with Veloxy")}</span>
								<kbd className="rounded border border-destructive/30 bg-muted/50 px-1 py-0.2 text-[9px] font-mono">
									{getShortcutDisplay("fixQueryError")}
								</kbd>
							</Button>
						) : null}
					</div>
				) : null}

				{saveResultEditsMutation.error ? (
					<div className="border-t border-border bg-destructive/10 px-4 py-2 text-xs text-destructive">
						{saveResultEditsMutation.error instanceof Error
							? saveResultEditsMutation.error.message
							: t("editor.failedToSaveEditedRows")}
					</div>
				) : null}
			</section>
		</section>
	);
}

export const QueryWorkspace = forwardRef<
	QueryWorkspaceHandle,
	QueryWorkspaceProps
>(function QueryWorkspace(
	{
		connectionId,
		connectionEngine,
		connectionError,
		connectionErrorMessage,
		isDark,
		onRequestConnection,
		resultsHeight,
		onResultsHeightChange,
		selectedTable,
		schemaLoading,
		schemaError,
		columnCount,
		primaryKeyColumns,
		editableColumns,
		saveDisabledReason,
		isResultSingleTableEditable,
		saveResultEditsMutation,
		onSaveResultEdits,
		onDeleteRows,
		onFocusedTabCapabilitiesChange,
		onActivateConnectionForTab,
		onOpenAddRow,
		insertRowTrigger,
		insertConnectionId,
		insertTable,
		canInsertRow,
		onInsertRowSuccess,
		onFixQueryError,
		onToggleAskVeloxy,
		onSaveQuery,
		onCreateChart,
	},
	ref,
) {
	const { t } = useTranslation()
	const queryClient = useQueryClient()
	const [state, dispatch] = useReducer(
		queryWorkspaceReducer,
		undefined,
		loadQueryWorkspaceInitialState,
	);
	const stateRef = useRef(state);
	stateRef.current = state;

	const layoutRef = useRef<HTMLDivElement | null>(null);

	const runQueryMutation = useRunQueryMutation({
		onSuccess: (result, variables) => {
			if (variables.connectionId) {
				dispatch({
					type: "pushHistory",
					connectionId: variables.connectionId,
					sql: variables.sql,
					rowCount: result.rowCount,
					executionMs: result.executionMs,
				});
			}
			dispatch({
				type: "runSuccess",
				tabId: variables.tabId,
				flightId: variables.flightId,
				executedSql: variables.sql.trim(),
				result,
			});
			if (result.commandTag != null) {
				notifySuccess(
					`Query executed`,
					`${result.rowCount} row${result.rowCount !== 1 ? "s" : ""} affected in ${result.executionMs} ms`,
				);
				// Auto-refresh sidebar table list after DDL/DML
				if (variables.connectionId) {
					void queryClient.invalidateQueries({ queryKey: queryKeys.tables(variables.connectionId) })
					void queryClient.invalidateQueries({ queryKey: queryKeys.foreignKeys(variables.connectionId) })
					void queryClient.invalidateQueries({ queryKey: queryKeys.schema(variables.connectionId, null) })
					void queryClient.invalidateQueries({ queryKey: ['tableIndexes'] })
				}
			} else {
				notifySuccess(
					`Query returned ${result.rowCount} row${result.rowCount !== 1 ? "s" : ""}`,
					`${result.executionMs} ms${result.truncated ? " (truncated to 1000 rows)" : ""}`,
				);
			}
		},
		onError: (error, variables) => {
			notifyError(error, { category: "query" });
			const message =
				error instanceof Error ? error.message : t("editor.failedToRunQuery");
			dispatch({
				type: "runError",
				tabId: variables.tabId,
				flightId: variables.flightId,
				message,
			});
		},
		onSettled: (_data, _error, variables) => {
			dispatch({
				type: "runSettled",
				tabId: variables.tabId,
				flightId: variables.flightId,
			});
		},
	});

	const explainPlanMutation = useExplainPlanMutation({
		onSuccess: (result, variables) => {
			dispatch({
				type: "explainSuccess",
				tabId: variables.tabId,
				flightId: variables.flightId,
				result,
			});
		},
		onError: (error, variables) => {
			notifyError(error, {
				category: "query",
				title: t("editor.explainFailed"),
			});
			const message =
				error instanceof Error ? error.message : t("editor.failedToRunExplain");
			dispatch({
				type: "explainError",
				tabId: variables.tabId,
				flightId: variables.flightId,
				message,
			});
		},
		onSettled: (_data, _error, variables) => {
			dispatch({
				type: "explainSettled",
				tabId: variables.tabId,
				flightId: variables.flightId,
			});
		},
	});

	const prevConnectionIdRef = useRef<string | undefined>(undefined);
	useEffect(() => {
		const id = connectionId ?? undefined;
		const prev = prevConnectionIdRef.current;
		if (prev !== undefined && prev !== id) {
			dispatch({ type: "connectionReset" });
			runQueryMutation.reset();
			explainPlanMutation.reset();
		}
		prevConnectionIdRef.current = id;
	}, [connectionId, runQueryMutation, explainPlanMutation]);

	const persistTimerRef = useRef<number | null>(null);
	const flushPersist = useCallback(() => {
		writePersistedQueryWorkspace(buildPersistSnapshot(stateRef.current));
	}, []);

	useEffect(() => {
		void state;
		if (persistTimerRef.current) {
			window.clearTimeout(persistTimerRef.current);
		}
		persistTimerRef.current = window.setTimeout(() => {
			persistTimerRef.current = null;
			flushPersist();
		}, 320);
		return () => {
			if (persistTimerRef.current) {
				window.clearTimeout(persistTimerRef.current);
				persistTimerRef.current = null;
			}
			flushPersist();
		};
	}, [state, flushPersist]);

	useEffect(() => {
		const onUnload = () => flushPersist();
		window.addEventListener("beforeunload", onUnload);
		window.addEventListener("pagehide", onUnload);
		return () => {
			window.removeEventListener("beforeunload", onUnload);
			window.removeEventListener("pagehide", onUnload);
			flushPersist();
		};
	}, [flushPersist]);

	useEffect(() => {
		if (!connectionId) return;
		const tab = stateRef.current.tabs[state.activeTabId];
		if (tab && tab.connectionId == null) {
			dispatch({ type: "setActiveTabConnection", connectionId });
		}
	}, [connectionId, state.activeTabId]);

	const focusedTabId = getFocusedTabId(state);
	const focusedTab = state.tabs[focusedTabId];
	const [historyOpen, setHistoryOpen] = useState(false);
	const [pendingWrite, setPendingWrite] = useState<{ tabId: string; sql: string } | null>(null);
	const [favorites, setFavorites] = useState<Set<string>>(() => {
		try {
			const stored = localStorage.getItem("veloxdb.queryFavorites");
			return stored
				? new Set<string>(JSON.parse(stored) as string[])
				: new Set<string>();
		} catch {
			return new Set<string>();
		}
	});
	const editorMetadataQuery = useQueryEditorMetadata(connectionId);
	const lintSqlMutation = useLintSqlMutation();
	const lintMutate = lintSqlMutation.mutate;
	const lintReset = lintSqlMutation.reset;
	const lintTimerRef = useRef<number | null>(null);

	useEffect(() => {
		const sql = focusedTab?.sql ?? "";
		const targetConnectionId =
			focusedTab?.connectionId ?? connectionId ?? undefined;
		if (lintTimerRef.current != null) {
			window.clearTimeout(lintTimerRef.current);
		}
		if (!targetConnectionId || sql.trim().length === 0 || connectionEngine === "mongo") {
			lintReset();
			return;
		}
		lintTimerRef.current = window.setTimeout(() => {
			lintTimerRef.current = null;
			lintMutate({ connectionId: targetConnectionId, sql });
		}, 280);
		return () => {
			if (lintTimerRef.current != null) {
				window.clearTimeout(lintTimerRef.current);
				lintTimerRef.current = null;
			}
		};
	}, [
		connectionId,
		focusedTab?.connectionId,
		focusedTab?.sql,
		lintMutate,
		lintReset,
	]);

	useEffect(() => {
		onFocusedTabCapabilitiesChange?.({
			hasLastQuery: Boolean(focusedTab?.lastExecutedSql?.trim()),
			hasResult: Boolean(focusedTab?.queryResult?.columns?.length),
		});
	}, [
		focusedTab?.lastExecutedSql,
		focusedTab?.queryResult,
		onFocusedTabCapabilitiesChange,
	]);

	const clampResultsHeight = useCallback((value: number) => {
		const containerHeight = layoutRef.current?.getBoundingClientRect().height;
		const maxResultsHeight = containerHeight
			? Math.max(MIN_RESULTS_HEIGHT, containerHeight - MIN_QUERY_HEIGHT - 8)
			: Math.max(MIN_RESULTS_HEIGHT, window.innerHeight - MIN_QUERY_HEIGHT - 8);
		return Math.min(maxResultsHeight, Math.max(MIN_RESULTS_HEIGHT, value));
	}, []);

	const handleResultsResizeStart = useCallback(
		(event: ReactPointerEvent<HTMLDivElement>) => {
			const startY = event.clientY;
			const startHeight = resultsHeight;
			const handlePointerMove = (moveEvent: PointerEvent) => {
				const deltaY = moveEvent.clientY - startY;
				onResultsHeightChange(clampResultsHeight(startHeight - deltaY));
			};
			const handlePointerUp = () => {
				window.removeEventListener("pointermove", handlePointerMove);
				window.removeEventListener("pointerup", handlePointerUp);
			};
			window.addEventListener("pointermove", handlePointerMove);
			window.addEventListener("pointerup", handlePointerUp);
		},
		[resultsHeight, onResultsHeightChange, clampResultsHeight],
	);

	const executeForTab = useCallback(
		(tabId: string, sql: string, allowWrite: boolean) => {
			const tab = stateRef.current.tabs[tabId];
			if (!tab) return;
			const targetId = tab.connectionId ?? connectionId;
			if (!targetId) {
				onRequestConnection();
				return;
			}
			const flightId = tab.runFlightId + 1;
			dispatch({ type: "runStart", tabId, flightId });
			runQueryMutation.mutate({
				connectionId: targetId,
				sql,
				allowWrite,
				tabId,
				flightId,
			});
		},
		[connectionId, onRequestConnection, runQueryMutation],
	);

	const runForTab = useCallback(
		(tabId: string, sql: string) => {
			const trimmed = sql.trim();
			if (!trimmed) return;
			const tab = stateRef.current.tabs[tabId];
			if (!tab) return;
			const targetId = tab.connectionId ?? connectionId;
			if (!targetId) {
				onRequestConnection();
				return;
			}
			const allowWrite = !isReadOnlySql(trimmed, connectionEngine ?? undefined);
			if (allowWrite) {
				setPendingWrite({ tabId, sql: trimmed });
				return;
			}
			executeForTab(tabId, trimmed, false);
		},
		[connectionId, connectionEngine, executeForTab, onRequestConnection],
	);

	const explainForTab = useCallback(
		(tabId: string, sql: string) => {
			const trimmed = sql.trim();
			if (!trimmed) return;
			const tab = stateRef.current.tabs[tabId];
			if (!tab) return;
			const targetId = tab.connectionId ?? connectionId;
			if (!targetId) {
				onRequestConnection();
				return;
			}
			const allowWrite = !isReadOnlySql(trimmed, connectionEngine ?? undefined);
			if (allowWrite && !window.confirm(t("editor.confirmWrite"))) {
				return;
			}
			const flightId = tab.explainFlightId + 1;
			dispatch({ type: "explainStart", tabId, flightId });
			explainPlanMutation.mutate({
				connectionId: targetId,
				engine: connectionEngine ?? "postgres",
				sql: trimmed,
				allowWrite,
				tabId,
				flightId,
			});
		},
		[connectionId, connectionEngine, onRequestConnection, explainPlanMutation, t],
	);

	useImperativeHandle(
		ref,
		() => ({
			applyTablePreview: (sql: string) => {
				const tabId = getFocusedTabId(stateRef.current);
				dispatch({
					type: "applyTablePreview",
					tabId,
					sql,
					bindConnectionId: connectionId ?? undefined,
				});
				runForTab(tabId, sql);
			},
			replaceQuerySql: (sql: string) => {
				const tabId = getFocusedTabId(stateRef.current);
				dispatch({
					type: "replaceTabSql",
					tabId,
					sql,
					bindConnectionId: connectionId ?? undefined,
				});
			},
			appendQuerySql: (sql: string) => {
				const tabId = getFocusedTabId(stateRef.current);
				dispatch({
					type: "appendSql",
					tabId,
					sql,
					bindConnectionId: connectionId ?? undefined,
				});
			},
			openTabWithSql: (sql: string) => {
				dispatch({
					type: "addTabWithSql",
					sql,
					connectionId: connectionId ?? null,
				});
			},
			openTabWithSqlAndRun: (sql: string) => {
				const trimmed = sql.trim();
				if (!trimmed) return;
				const targetId = connectionId ?? null;
				if (!targetId) {
					onRequestConnection();
					return;
				}
				const tabId = crypto.randomUUID();
				dispatch({
					type: "addTabWithSql",
					tabId,
					sql: trimmed,
					connectionId: targetId,
				});
				const flightId = 1;
				dispatch({ type: "runStart", tabId, flightId });
				runQueryMutation.mutate({
					connectionId: targetId,
					sql: trimmed,
					allowWrite: !isReadOnlySql(trimmed, connectionEngine ?? undefined),
					tabId,
					flightId,
				});
			},
			setActiveTabConnection: (cid: string | null) => {
				dispatch({ type: "setActiveTabConnection", connectionId: cid });
			},
			detachDeletedConnection: (cid: string) => {
				dispatch({ type: "detachDeletedConnection", connectionId: cid });
			},
			runLastQuery: () => {
				const tabId = getFocusedTabId(stateRef.current);
				const tab = stateRef.current.tabs[tabId];
				const sql = tab?.lastExecutedSql?.trim() || tab?.sql?.trim();
				if (sql) runForTab(tabId, sql);
			},
			refreshFocusedResults: () => {
				const tabId = getFocusedTabId(stateRef.current);
				const tab = stateRef.current.tabs[tabId];
				const sql = tab?.lastExecutedSql?.trim() || tab?.sql?.trim();
				if (sql) runForTab(tabId, sql);
			},
			getHasLastQuery: () => {
				const tabId = getFocusedTabId(stateRef.current);
				return Boolean(stateRef.current.tabs[tabId]?.lastExecutedSql?.trim());
			},
			toggleAskVeloxy: () => {
				onToggleAskVeloxy?.();
			},
			getActiveTabSql: () => {
				const tabId = getFocusedTabId(stateRef.current);
				return stateRef.current.tabs[tabId]?.sql ?? null;
			},
			getActiveTabConnectionId: () => {
				const tabId = getFocusedTabId(stateRef.current);
				return stateRef.current.tabs[tabId]?.connectionId ?? connectionId ?? null;
			},
			getActiveTabLastExecutedSql: () => {
				const tabId = getFocusedTabId(stateRef.current);
				return stateRef.current.tabs[tabId]?.lastExecutedSql?.trim() || null;
			},
		}),
		[runForTab, connectionId, onRequestConnection, runQueryMutation, onToggleAskVeloxy],
	);

	const handleToolbarRun = useCallback(() => {
		const tabId = getFocusedTabId(stateRef.current);
		const sql = stateRef.current.tabs[tabId]?.sql ?? "";
		runForTab(tabId, sql);
	}, [runForTab]);

	const handleToolbarRunStatement = useCallback(() => {
		const tabId = getFocusedTabId(stateRef.current);
		const sql = stateRef.current.tabs[tabId]?.sql ?? "";
		runForTab(tabId, sql);
	}, [runForTab]);

	const handleToolbarExplain = useCallback(() => {
		const tabId = getFocusedTabId(stateRef.current);
		const sql = stateRef.current.tabs[tabId]?.sql ?? "";
		explainForTab(tabId, sql);
	}, [explainForTab]);

	const handleFormatSql = useCallback(() => {
		const tabId = getFocusedTabId(stateRef.current);
		const sql = stateRef.current.tabs[tabId]?.sql ?? "";
		if (!sql.trim()) return;

		if (connectionEngine === "mongo") {
			try {
				const match = sql.trim().match(/^(?:db\.)?([a-zA-Z0-9_]+)\.([a-zA-Z0-9_]+)\(([\s\S]*)\)$/);
				if (match) {
					const [, coll, method, args] = match;
					const parsed = JSON.parse(args.replace(/'/g, '"'));
					const formattedArgs = JSON.stringify(parsed, null, 2);
					dispatch({ type: "replaceTabSql", tabId, sql: `db.${coll}.${method}(\n  ${formattedArgs.split("\n").join("\n  ")}\n)` });
					return;
				}
				const parsed = JSON.parse(sql.trim().replace(/'/g, '"'));
				dispatch({ type: "replaceTabSql", tabId, sql: JSON.stringify(parsed, null, 2) });
				return;
			} catch {
				return;
			}
		}

		if (connectionEngine === "redis") {
			return;
		}

		try {
			const language =
				connectionEngine === "mysql"
					? "mysql"
					: connectionEngine === "sqlite" || connectionEngine === "duckdb"
						? "sqlite"
						: "postgresql";
			const formatted = format(sql, {
				language,
				tabWidth: 2,
				keywordCase: "upper",
				linesBetweenQueries: 2,
			});
			dispatch({ type: "replaceTabSql", tabId, sql: formatted });
		} catch {
			// graceful fallback
		}
	}, [connectionEngine]);

	const handleFixQueryError = useCallback((sql: string, errorMessage: string) => {
		onFixQueryError?.(sql, errorMessage);
	}, [onFixQueryError]);

	useAppHotkey("formatSql", () => {
		handleFormatSql();
	});

	useAppHotkey("fixQueryError", () => {
		const tabId = getFocusedTabId(stateRef.current);
		const tab = stateRef.current.tabs[tabId];
		const error = tab?.runError || tab?.planError;
		if (error && tab?.sql) {
			handleFixQueryError(tab.sql, error);
		} else {
			onToggleAskVeloxy?.();
		}
	});

	const activeTab = state.tabs[state.activeTabId];
	const toolbarBusy = Boolean(
		activeTab?.runInFlight || activeTab?.explainInFlight,
	);
	const activeConnectionForHistory =
		activeTab?.connectionId ?? connectionId ?? null;
	const historyEntries: QueryHistoryEntry[] = useMemo(
		() =>
			activeConnectionForHistory
				? (state.queryHistoryByConnection[activeConnectionForHistory] ?? [])
				: [],
		[activeConnectionForHistory, state.queryHistoryByConnection],
	);

	const handleToggleFavorite = useCallback((entryId: string) => {
		setFavorites((prev) => {
			const next = new Set(prev);
			if (next.has(entryId)) next.delete(entryId);
			else next.add(entryId);
			localStorage.setItem("veloxdb.queryFavorites", JSON.stringify([...next]));
			return next;
		});
	}, []);

	const handleClearHistory = useCallback(() => {
		dispatch({
			type: "clearHistory",
			connectionId: activeConnectionForHistory ?? undefined,
		});
	}, [activeConnectionForHistory]);
	const lintDiagnostics = lintSqlMutation.data?.diagnostics ?? [];

	const handleSelectQueryTab = useCallback(
		(tabId: string) => {
			const tab = state.tabs[tabId];
			if (!tab) return;
			if (!tab.connectionId && connectionId) {
				dispatch({ type: "setTabConnection", tabId, connectionId });
			}
			dispatch({ type: "selectTab", tabId });
			const resolved = tab.connectionId ?? connectionId;
			if (resolved && resolved !== connectionId) {
				onActivateConnectionForTab?.(resolved);
			}
		},
		[state.tabs, connectionId, onActivateConnectionForTab],
	);

	return (
		<div
			ref={layoutRef}
			className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
		>
			<div className="relative flex min-w-0 shrink-0 flex-col gap-2 border-b border-border px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
				<div
					className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto"
					role="tablist"
					aria-label={t("editor.queryTabs")}
				>
					{state.tabOrder.map((id) => {
						const tab = state.tabs[id];
						if (!tab) return null;
						const isActive = id === state.activeTabId;
						return (
							<div
								key={id}
								className={cn(
									"group flex max-w-[200px] shrink-0 items-center rounded-md border border-transparent",
									isActive ? "border-border bg-muted/40" : "hover:bg-muted/30",
								)}
							>
								<button
									type="button"
									role="tab"
									aria-selected={isActive}
									className="min-w-0 flex-1 truncate px-2.5 py-1.5 text-left text-xs text-foreground"
									onClick={() => handleSelectQueryTab(id)}
								>
									{tab.title}
								</button>
								<Button
									type="button"
									variant="ghost"
									size="icon-sm"
									className="h-7 w-7 shrink-0 opacity-60 hover:opacity-100"
									aria-label={`Close ${tab.title}`}
									disabled={state.tabOrder.length <= 1}
									onClick={(e) => {
										e.stopPropagation();
										dispatch({ type: "closeTab", tabId: id });
									}}
								>
									<XIcon className="size-3.5" />
								</Button>
							</div>
						);
					})}
					<Button
						type="button"
						variant="outline"
						size="icon-sm"
						className="shrink-0"
						aria-label={t("editor.newQueryTab")}
						onClick={() =>
							dispatch({
								type: "addTab",
								connectionId: connectionId ?? null,
							})
						}
					>
						<PlusIcon />
					</Button>
				</div>
				<div className="flex shrink-0 items-center gap-3">
					<div className="hidden min-h-4 min-w-[132px] items-center justify-end text-right xl:flex">
						{editorMetadataQuery.isFetching ? (
							<span className="text-[11px] text-muted-foreground">
								{t("editor.loadingMetadata2")}
							</span>
						) : null}
					</div>
					<div className="flex items-center gap-1">
						<Popover>
							<PopoverTrigger asChild>
								<Button
									variant="ghost"
									size="icon-sm"
									aria-label={t("editor.moreActions")}
									title={t("editor.moreActions")}
								>
									<DotsThreeIcon className="size-4" />
								</Button>
							</PopoverTrigger>
							<PopoverContent align="end" className="w-52 p-1">
								{onSaveQuery ? (
									<button
										type="button"
										className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-accent disabled:opacity-50"
										disabled={!activeConnectionForHistory}
										onClick={onSaveQuery}
									>
										<FloppyDiskIcon className="size-3.5 text-muted-foreground" />
										{t("savedQuery.saveQuery")}
									</button>
								) : null}
								<button
									type="button"
									className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-accent"
									onClick={handleFormatSql}
								>
									<TextHIcon className="size-3.5 text-muted-foreground" />
									{t("editor.formatSql")}
								</button>
								<button
									type="button"
									className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-accent disabled:opacity-50"
									disabled={!activeConnectionForHistory}
									onClick={() => setHistoryOpen(true)}
								>
									{t("editor.historyTitle")}
								</button>
								<button
									type="button"
									className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-accent disabled:opacity-50"
									disabled={toolbarBusy}
									onClick={handleToolbarExplain}
								>
									<DatabaseIcon className="size-3.5 text-muted-foreground" />
									{connectionEngine === "postgres"
										? t("editor.explainAnalyze")
										: t("editor.explainTitle", "Explain")}
								</button>
							</PopoverContent>
						</Popover>
						<div className="flex items-center">
							<Button
								variant="default"
								size="sm"
								className="h-8 gap-1 rounded-r-none px-3"
								onClick={handleToolbarRun}
								disabled={toolbarBusy}
								aria-label={t("editor.runQueryBtn")}
								title={`${t("editor.runQueryBtn")} (${getShortcutDisplay("runQuery") || "Cmd+Enter"})`}
							>
								<PlayIcon weight="fill" className="size-3.5" />
								{t("editor.runQueryBtn")}
							</Button>
							<Popover>
								<PopoverTrigger asChild>
									<Button
										variant="default"
										size="icon-sm"
										className="h-8 w-7 rounded-l-none border-l border-primary-foreground/20"
										disabled={toolbarBusy}
										aria-label={t("editor.runStatementMenu")}
									>
										<CaretDownIcon className="size-3" />
									</Button>
								</PopoverTrigger>
								<PopoverContent align="end" className="w-48 p-1">
									<button
										type="button"
										className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-xs hover:bg-accent"
										onClick={handleToolbarRunStatement}
									>
										<span>{t("editor.runStatementMenu")}</span>
										<span className="text-[10px] text-muted-foreground">
											{getShortcutDisplay("runSelection") || "Cmd+Shift+Enter"}
										</span>
									</button>
								</PopoverContent>
							</Popover>
						</div>
					</div>
				</div>
				{toolbarBusy ? (
					<div className="pointer-events-none absolute bottom-0 left-0 right-0 h-[2px] overflow-hidden z-30" aria-hidden="true">
						<div className="h-full w-full bg-gradient-to-r from-transparent via-primary to-transparent animate-laser-sweep" />
					</div>
				) : null}
			</div>

			{pendingWrite ? (
				<div className="flex shrink-0 items-center justify-between gap-3 border-b border-amber-500/30 bg-amber-500/10 px-3 py-2">
					<p className="text-xs text-foreground">{t("editor.confirmWriteBanner")}</p>
					<div className="flex items-center gap-2">
						<Button
							size="sm"
							variant="outline"
							onClick={() => setPendingWrite(null)}
						>
							{t("connection.cancel")}
						</Button>
						<Button
							size="sm"
							onClick={() => {
								executeForTab(pendingWrite.tabId, pendingWrite.sql, true);
								setPendingWrite(null);
							}}
						>
							{t("editor.runAnyway")}
						</Button>
					</div>
				</div>
			) : null}

			{!connectionId ? (
				<div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
					<p className="text-sm font-medium text-foreground">{t("editor.connectToStart")}</p>
					<p className="max-w-sm text-xs text-muted-foreground">{t("editor.connectToStartDesc")}</p>
					<Button size="sm" onClick={onRequestConnection}>
						{t("sidebar.connectDatabase")}
					</Button>
				</div>
			) : activeTab ? (
				<QueryPane
					tab={activeTab}
					connectionEngine={connectionEngine}
					isDark={isDark}
					onSqlChange={(sql) =>
						dispatch({ type: "setSql", tabId: activeTab.id, sql })
					}
					onRun={() =>
						runForTab(
							activeTab.id,
							stateRef.current.tabs[activeTab.id]?.sql ?? "",
						)
					}
					onRunStatement={(sql) => runForTab(activeTab.id, sql)}
					onResultsSubTabChange={(value) =>
						dispatch({
							type: "setResultsSubTab",
							tabId: activeTab.id,
							value,
						})
					}
					editorMetadata={editorMetadataQuery.data}
					lintDiagnostics={lintDiagnostics}
					resultsHeight={resultsHeight}
					onResultsResizeStart={handleResultsResizeStart}
					selectedTable={selectedTable}
					schemaLoading={schemaLoading}
					schemaError={schemaError}
					columnCount={columnCount}
					saveDisabledReason={saveDisabledReason}
					isResultSingleTableEditable={isResultSingleTableEditable}
					editableColumns={editableColumns}
					primaryKeyColumns={primaryKeyColumns}
					saveResultEditsMutation={saveResultEditsMutation}
					onSaveResultEdits={onSaveResultEdits}
					onDeleteRows={onDeleteRows}
					onRefreshResults={() => {
						const t = stateRef.current.tabs[activeTab.id];
						runForTab(activeTab.id, t?.lastExecutedSql || t?.sql || "");
					}}
					onRefreshPlan={() =>
						explainForTab(
							activeTab.id,
							stateRef.current.tabs[activeTab.id]?.sql ?? "",
						)
					}
					connectionError={connectionError}
					connectionErrorMessage={connectionErrorMessage}
					onAddRow={onOpenAddRow}
					insertRowTrigger={insertRowTrigger}
					insertConnectionId={insertConnectionId}
					insertTable={insertTable}
					canInsertRow={canInsertRow}
					onInsertRowSuccess={onInsertRowSuccess}
					onFixQueryError={handleFixQueryError}
					onCreateChart={onCreateChart}
				/>
			) : null}
			<QueryHistoryPanel
				open={historyOpen}
				onOpenChange={setHistoryOpen}
				connectionId={connectionId}
				onOpenVeloxy={onToggleAskVeloxy}
				history={historyEntries}
				onLoadQuery={(entry) => {
					dispatch({ type: "addTab", connectionId: connectionId ?? null });
					const newState = stateRef.current;
					const lastTabId = newState.tabOrder[newState.tabOrder.length - 1];
					if (lastTabId) {
						dispatch({
							type: "replaceTabSql",
							tabId: lastTabId,
							sql: entry.sql,
						});
					}
				}}
				onClearHistory={handleClearHistory}
				favorites={favorites}
				onToggleFavorite={handleToggleFavorite}
			/>
		</div>
	);
});
