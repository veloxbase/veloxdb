import {
	ClockCounterClockwiseIcon,
	DatabaseIcon,
	PlayIcon,
	PlugIcon,
	PlusIcon,
	RobotIcon,
	TextHIcon,
	XIcon,
} from "@phosphor-icons/react";
import type { UseMutationResult } from "@tanstack/react-query";
import {
	forwardRef,
	type ReactNode,
	type PointerEvent as ReactPointerEvent,
	useCallback,
	useEffect,
	useImperativeHandle,
	useMemo,
	useReducer,
	useRef,
	useState,
} from "react";
import { format } from "sql-formatter";

import { ErrorBoundary } from "@/components/ErrorBoundary";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { DatabaseEngine, TableInfo } from "@/data/types";
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
import { cn } from "@/lib/utils";

const ASK_VELOXY_WIDTH_KEY = "veloxdb.askVeloxyWidth";
const DEFAULT_ASK_VELOXY_WIDTH = 320;
const MIN_ASK_VELOXY_WIDTH = 240;
const MAX_ASK_VELOXY_WIDTH = 560;

function clampAskVeloxyWidth(value: number) {
	return Math.min(MAX_ASK_VELOXY_WIDTH, Math.max(MIN_ASK_VELOXY_WIDTH, value));
}

function readAskVeloxyWidth() {
	const raw = Number(window.localStorage.getItem(ASK_VELOXY_WIDTH_KEY));
	return Number.isFinite(raw)
		? clampAskVeloxyWidth(raw)
		: DEFAULT_ASK_VELOXY_WIDTH;
}

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
	askVeloxySidebar?: (onClose: () => void) => ReactNode;
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
	askVeloxySidebar?: ReactNode;
	isAskVeloxyOpen: boolean;
	askVeloxyWidth: number;
	onAskVeloxyResizeStart: (event: ReactPointerEvent<HTMLDivElement>) => void;
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
	askVeloxySidebar,
	isAskVeloxyOpen,
	askVeloxyWidth,
	onAskVeloxyResizeStart,
}: QueryPaneProps) {
	const resultsTab = tab.resultsSubTab;
	const runPending = tab.runInFlight;
	const explainPending = tab.explainInFlight;

	return (
		<section
			className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden outline-none"
			aria-label="Query editor"
		>
			<section className="relative z-0 min-h-0 min-w-0 flex-1 overflow-hidden">
				<div className="flex h-full min-w-0 overflow-hidden">
					<div className="min-h-0 h-full min-w-0 flex-1 overflow-hidden contain-[layout_paint]">
						<SqlEditor
							value={tab.sql}
							isDark={isDark}
							onChange={onSqlChange}
							onRun={onRun}
							onRunStatement={onRunStatement}
							metadata={editorMetadata}
							diagnostics={lintDiagnostics}
						/>
					</div>
					{isAskVeloxyOpen && askVeloxySidebar ? (
						<>
							<div
								className="w-1 shrink-0 cursor-col-resize border-x border-transparent bg-muted/20 transition-colors hover:bg-muted/60"
								onPointerDown={onAskVeloxyResizeStart}
								title="Resize Ask Veloxy"
							/>
							<aside
								className="h-full min-h-0 min-w-0 shrink-0 overflow-hidden border-l border-border"
								style={{ width: askVeloxyWidth }}
							>
								{askVeloxySidebar}
							</aside>
						</>
					) : null}
				</div>
			</section>

			<div
				className="relative z-20 h-1 shrink-0 cursor-row-resize border-y border-border bg-muted/10 hover:bg-muted/30"
				onPointerDown={onResultsResizeStart}
				title="Resize results"
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
										Results
									</TabsTrigger>
									<TabsTrigger value="plan" className="text-xs">
										Explain plan
									</TabsTrigger>
								</TabsList>
								<p className="mt-1 truncate text-sm text-foreground">
									{resultsTab === "plan"
										? connectionEngine === "mysql"
											? "EXPLAIN output"
											: connectionEngine === "sqlite"
												? "EXPLAIN QUERY PLAN output"
												: "EXPLAIN (ANALYZE, BUFFERS) output"
										: selectedTable
											? `${selectedTable.schema}.${selectedTable.name}`
											: "Current query output"}
								</p>
							</div>

							<div className="shrink-0 text-right text-xs text-muted-foreground whitespace-nowrap">
								{resultsTab === "plan" ? (
									<span>
										{tab.planResult
											? `${tab.planResult.rowCount} plan lines in ${tab.planResult.executionMs} ms`
											: explainPending
												? "Running EXPLAIN…"
												: connectionEngine === "postgres"
													? "Run Explain (analyze) from the toolbar"
													: "Run Explain from the toolbar"}
									</span>
								) : tab.queryResult ? (
									<span>
										{`${tab.queryResult.rowCount} rows in ${tab.queryResult.executionMs} ms`}
										{columnCount != null
											? ` · ${columnCount} columns in selected table`
											: ""}
									</span>
								) : schemaLoading ? (
									<span>Loading columns...</span>
								) : schemaError ? (
									<span className="text-destructive">{schemaError}</span>
								) : columnCount != null ? (
									<span>{columnCount} columns in selected table</span>
								) : (
									<span>No query executed yet</span>
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
								saveDisabledReason="Editing is not available for EXPLAIN output."
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
						Output was truncated to keep the UI responsive.
					</div>
				) : null}

				{connectionError ? (
					<div className="border-t border-border bg-destructive/10 px-4 py-2 text-xs text-destructive">
						{connectionErrorMessage}
					</div>
				) : null}

				{tab.runError ? (
					<div className="border-t border-border bg-destructive/10 px-4 py-2 text-xs text-destructive">
						{tab.runError}
					</div>
				) : null}

				{tab.planError ? (
					<div className="border-t border-border bg-destructive/10 px-4 py-2 text-xs text-destructive">
						{tab.planError}
					</div>
				) : null}

				{saveResultEditsMutation.error ? (
					<div className="border-t border-border bg-destructive/10 px-4 py-2 text-xs text-destructive">
						{saveResultEditsMutation.error instanceof Error
							? saveResultEditsMutation.error.message
							: "Failed to save edited rows"}
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
		askVeloxySidebar,
	},
	ref,
) {
	const [state, dispatch] = useReducer(
		queryWorkspaceReducer,
		undefined,
		loadQueryWorkspaceInitialState,
	);
	const stateRef = useRef(state);

	const layoutRef = useRef<HTMLDivElement | null>(null);

	useEffect(() => {
		stateRef.current = state;
	}, [state]);

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
				error instanceof Error ? error.message : "Failed to run query";
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
				title: "EXPLAIN failed",
			});
			const message =
				error instanceof Error ? error.message : "Failed to run EXPLAIN";
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
		};
	}, [state, flushPersist]);

	useEffect(() => {
		const onUnload = () => flushPersist();
		window.addEventListener("beforeunload", onUnload);
		return () => window.removeEventListener("beforeunload", onUnload);
	}, [flushPersist]);

	const focusedTabId = getFocusedTabId(state);
	const focusedTab = state.tabs[focusedTabId];
	const [historyOpen, setHistoryOpen] = useState(false);
	const [isAskVeloxyOpen, setIsAskVeloxyOpen] = useState(false);
	const [askVeloxyWidth, setAskVeloxyWidth] = useState(readAskVeloxyWidth);
	const askVeloxyOpen = Boolean(connectionId) && isAskVeloxyOpen;

	useEffect(() => {
		window.localStorage.setItem(ASK_VELOXY_WIDTH_KEY, String(askVeloxyWidth));
	}, [askVeloxyWidth]);

	const handleAskVeloxyResizeStart = useCallback(
		(event: ReactPointerEvent<HTMLDivElement>) => {
			event.preventDefault();
			const startX = event.clientX;
			const startWidth = askVeloxyWidth;
			const handlePointerMove = (moveEvent: PointerEvent) => {
				const delta = moveEvent.clientX - startX;
				setAskVeloxyWidth(clampAskVeloxyWidth(startWidth - delta));
			};
			const handlePointerUp = () => {
				window.removeEventListener("pointermove", handlePointerMove);
				window.removeEventListener("pointerup", handlePointerUp);
			};
			window.addEventListener("pointermove", handlePointerMove);
			window.addEventListener("pointerup", handlePointerUp);
		},
		[askVeloxyWidth],
	);
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
		if (!targetConnectionId || sql.trim().length === 0) {
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
			const flightId = tab.runFlightId + 1;
			dispatch({ type: "runStart", tabId, flightId });
			runQueryMutation.mutate({
				connectionId: targetId,
				sql: trimmed,
				tabId,
				flightId,
			});
		},
		[connectionId, onRequestConnection, runQueryMutation],
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
			const flightId = tab.explainFlightId + 1;
			dispatch({ type: "explainStart", tabId, flightId });
			explainPlanMutation.mutate({
				connectionId: targetId,
				engine: connectionEngine ?? "postgres",
				sql: trimmed,
				tabId,
				flightId,
			});
		},
		[connectionId, connectionEngine, onRequestConnection, explainPlanMutation],
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
		}),
		[runForTab, connectionId, onRequestConnection, runQueryMutation],
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
		try {
			const language =
				connectionEngine === "mysql"
					? "mysql"
					: connectionEngine === "sqlite"
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

	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			const commandKey = event.metaKey || event.ctrlKey;
			if (commandKey && event.shiftKey && event.key === "F") {
				event.preventDefault();
				handleFormatSql();
			}
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [handleFormatSql]);

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
			<div className="flex min-w-0 shrink-0 flex-col gap-2 border-b border-border px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
				<div
					className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto"
					role="tablist"
					aria-label="Query tabs"
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
						aria-label="New query tab"
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
								Loading metadata...
							</span>
						) : null}
					</div>
					<div className="flex items-center gap-1">
						<Button
							variant="ghost"
							size="icon-sm"
							onClick={handleFormatSql}
							aria-label="Format SQL (Cmd/Ctrl+Shift+F)"
							title="Format SQL (Cmd/Ctrl+Shift+F)"
						>
							<TextHIcon />
						</Button>
						<Button
							variant="ghost"
							size="icon-sm"
							onClick={() => setHistoryOpen(true)}
							disabled={!activeConnectionForHistory}
							aria-label="Open query history"
							title="Query history"
						>
							<ClockCounterClockwiseIcon />
						</Button>
						<Button
							variant="ghost"
							size="icon-sm"
							onClick={handleToolbarExplain}
							disabled={toolbarBusy}
							aria-label={
								connectionEngine === "postgres"
									? "Run explain analyze"
									: "Run explain"
							}
							title={
								connectionEngine === "postgres"
									? "Explain (analyze)"
									: "Explain"
							}
						>
							<DatabaseIcon />
						</Button>
						<Button
							variant="outline"
							size="icon-sm"
							onClick={handleToolbarRunStatement}
							disabled={toolbarBusy}
							aria-label="Run current statement"
							title="Run statement"
						>
							<PlugIcon />
						</Button>
						<Button
							variant="default"
							size="icon-sm"
							onClick={handleToolbarRun}
							disabled={toolbarBusy}
							aria-label="Run query"
							title="Run query"
						>
							<PlayIcon weight="fill" />
						</Button>
						<Button
							variant={askVeloxyOpen ? "default" : "outline"}
							size="sm"
							onClick={() => setIsAskVeloxyOpen((prev) => !prev)}
							disabled={!connectionId}
							aria-label="Ask Veloxy"
							title="Ask Veloxy"
							className="gap-1.5"
						>
							<RobotIcon className="size-4" />
							Ask Veloxy
						</Button>
					</div>
				</div>
			</div>

			{activeTab ? (
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
					askVeloxySidebar={
						askVeloxySidebar
							? askVeloxySidebar(() => setIsAskVeloxyOpen(false))
							: undefined
					}
					isAskVeloxyOpen={askVeloxyOpen}
					askVeloxyWidth={askVeloxyWidth}
					onAskVeloxyResizeStart={handleAskVeloxyResizeStart}
				/>
			) : null}
			<QueryHistoryPanel
				open={historyOpen}
				onOpenChange={setHistoryOpen}
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
