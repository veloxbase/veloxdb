import { PlusIcon, XIcon } from "@phosphor-icons/react";
import type { UseMutationResult } from "@tanstack/react-query";
import {
	forwardRef,
	type PointerEvent as ReactPointerEvent,
	useCallback,
	useEffect,
	useImperativeHandle,
	useReducer,
	useRef,
} from "react";

import { ErrorBoundary } from "@/components/ErrorBoundary";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { TableInfo } from "@/data/types";
import { ResultsGrid } from "@/features/queries/components/ResultsGrid";
import { SqlEditor } from "@/features/queries/components/SqlEditor";
import {
	useExplainPlanMutation,
	useRunQueryMutation,
} from "@/features/queries/queries";
import {
	toPersistedSnapshot,
	writePersistedQueryWorkspace,
} from "@/features/queries/query-workspace-persistence";
import {
	getFocusedTabId,
	loadQueryWorkspaceInitialState,
	type QueryTabModel,
	type QueryWorkspaceState,
	queryWorkspaceReducer,
} from "@/features/queries/query-workspace-state";
import type {
	ResultEditPatch,
	SaveResultEditsRequest,
} from "@/features/queries/result-edits";
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
	runLastQuery: () => void;
	refreshFocusedResults: () => void;
	getHasLastQuery: () => boolean;
	/** Keep the active query tab aligned with the connection chosen in the sidebar. */
	setActiveTabConnection: (connectionId: string | null) => void;
};

type QueryWorkspaceProps = {
	connectionId: string | null;
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
	onFocusedTabCapabilitiesChange?: (caps: {
		hasLastQuery: boolean;
		hasResult: boolean;
	}) => void;
	/** When switching to a tab that targets another saved connection, activate it in the shell. */
	onActivateConnectionForTab?: (connectionId: string) => void;
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
	});
}

type QueryPaneProps = {
	tab: QueryTabModel;
	isDark: boolean;
	onSqlChange: (sql: string) => void;
	onRun: () => void;
	onResultsSubTabChange: (value: "results" | "plan") => void;
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
	onRefreshResults: () => void;
	onRefreshPlan: () => void;
	connectionError: unknown;
	connectionErrorMessage: string;
};

function QueryPane({
	tab,
	isDark,
	onSqlChange,
	onRun,
	onResultsSubTabChange,
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
	onRefreshResults,
	onRefreshPlan,
	connectionError,
	connectionErrorMessage,
}: QueryPaneProps) {
	const resultsTab = tab.resultsSubTab;
	const runPending = tab.runInFlight;
	const explainPending = tab.explainInFlight;

	return (
		<section
			className="flex min-h-0 min-w-0 flex-1 flex-col outline-none"
			aria-label="Query editor"
		>
			<section className="min-h-0 min-w-0 flex-1">
				<SqlEditor
					value={tab.sql}
					isDark={isDark}
					onChange={onSqlChange}
					onRun={onRun}
				/>
			</section>

			<div
				className="h-1 cursor-row-resize border-y border-border bg-muted/10 hover:bg-muted/30"
				onPointerDown={onResultsResizeStart}
				title="Resize results"
			/>

			<section
				className="min-h-0 min-w-0 h-full overflow-hidden"
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
										? "EXPLAIN (ANALYZE, BUFFERS) output"
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
												: "Run Explain (analyze) from the toolbar"}
									</span>
								) : schemaLoading ? (
									<span>Loading columns...</span>
								) : schemaError ? (
									<span className="text-destructive">{schemaError}</span>
								) : columnCount != null ? (
									<span>{columnCount} columns in selected table</span>
								) : (
									<span>
										{tab.queryResult
											? `${tab.queryResult.rowCount} rows in ${tab.queryResult.executionMs} ms`
											: "No query executed yet"}
									</span>
								)}
							</div>
						</div>
					</div>

					<TabsContent
						value="results"
						className="m-0 min-h-0 flex-1 data-[state=inactive]:hidden"
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
							/>
						</ErrorBoundary>
					</TabsContent>

					<TabsContent
						value="plan"
						className="m-0 min-h-0 flex-1 data-[state=inactive]:hidden"
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
		onFocusedTabCapabilitiesChange,
		onActivateConnectionForTab,
	},
	ref,
) {
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
			dispatch({
				type: "runSuccess",
				tabId: variables.tabId,
				flightId: variables.flightId,
				executedSql: variables.sql.trim(),
				result,
			});
		},
		onError: (error, variables) => {
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
				sql: trimmed,
				tabId,
				flightId,
			});
		},
		[connectionId, onRequestConnection, explainPlanMutation],
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
			setActiveTabConnection: (cid: string | null) => {
				dispatch({ type: "setActiveTabConnection", connectionId: cid });
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
		[runForTab, connectionId],
	);

	const handleToolbarRun = useCallback(() => {
		const tabId = getFocusedTabId(stateRef.current);
		const sql = stateRef.current.tabs[tabId]?.sql ?? "";
		runForTab(tabId, sql);
	}, [runForTab]);

	const handleToolbarExplain = useCallback(() => {
		const tabId = getFocusedTabId(stateRef.current);
		const sql = stateRef.current.tabs[tabId]?.sql ?? "";
		explainForTab(tabId, sql);
	}, [explainForTab]);

	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			const commandKey = event.metaKey || event.ctrlKey;
			if (commandKey && event.key === "Enter") {
				event.preventDefault();
				handleToolbarRun();
			}
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [handleToolbarRun]);

	const activeTab = state.tabs[state.activeTabId];
	const toolbarBusy = Boolean(
		activeTab?.runInFlight || activeTab?.explainInFlight,
	);

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
		<div ref={layoutRef} className="flex min-h-0 min-w-0 flex-1 flex-col">
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
				<div className="flex shrink-0 items-center gap-2">
					<Button
						variant="outline"
						size="sm"
						onClick={handleToolbarExplain}
						disabled={toolbarBusy}
					>
						Explain (analyze)
					</Button>
					<Button
						variant="default"
						size="sm"
						onClick={handleToolbarRun}
						disabled={toolbarBusy}
					>
						Run query
					</Button>
					<span className="hidden text-[11px] uppercase tracking-[0.18em] text-muted-foreground sm:inline">
						Cmd/Ctrl + Enter
					</span>
				</div>
			</div>

			{activeTab ? (
				<QueryPane
					tab={activeTab}
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
					onResultsSubTabChange={(value) =>
						dispatch({
							type: "setResultsSubTab",
							tabId: activeTab.id,
							value,
						})
					}
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
				/>
			) : null}
		</div>
	);
});
