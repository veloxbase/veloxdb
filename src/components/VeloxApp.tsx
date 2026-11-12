import { CommandIcon, GearIcon, RobotIcon, SidebarSimpleIcon } from "@phosphor-icons/react";
import {
	type CSSProperties,
	type PointerEvent as ReactPointerEvent,
	lazy,
	Suspense,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";

import { ErrorBoundary } from "@/components/ErrorBoundary";
import { Button } from "@/components/ui/button";
import { queryKeys } from "@/data/query-keys";
import { veloxDbRepository } from "@/data/repositories";
import type { Dashboard } from "@/data/types";
import { CommandPalette } from "@/features/commands/components/CommandPalette";
import { ShortcutSheet } from "@/features/commands/components/ShortcutSheet";
import { SettingsDialog, type SettingsTabId } from "@/features/commands/components/SettingsDialog";
import { ThemeSelector } from "@/components/ThemeSelector";
import { ConnectionDialog } from "@/features/connections/components/ConnectionDialog";
import { RenameConnectionDialog } from "@/features/connections/components/RenameConnectionDialog";
import { QueryWorkspace } from "@/features/queries/components/QueryWorkspace";
import type {
	VeloxyChartContext,
	VeloxyFixErrorContext,
} from "@/features/queries/components/AskVeloxyDialog";
import {
	loadVeloxyDrawerOpen,
	loadVeloxyDrawerWidth,
	saveVeloxyDrawerOpen,
	saveVeloxyDrawerWidth,
	clampVeloxyWidth,
} from "@/features/queries/veloxy/veloxy-ui-persistence";
import { TablePropertiesDialog } from "@/features/schema/components/TablePropertiesDialog";
import type { BuilderChartType, ChartEncodings } from "@/features/dashboards/chart-builder-state";
import type { OpenSqlInEditorOptions } from "@/features/dashboards/components/DashboardWorkspace";
import { canUseDashboards } from "@/features/dashboards/engine-guard";
import { SaveQueryDialog } from "@/features/dashboards/components/SaveQueryDialog";
import { isVeloxyConfigured, useSettings } from "@/lib/settings";
import { useAppHotkey } from "@/lib/shortcuts/use-app-hotkey";
import { ActivityRail } from "@/features/workspace/components/ActivityRail";
import { ContextSidebar } from "@/features/workspace/components/ContextSidebar";
import {
	loadGlobalLastDashboardId,
	saveLastDashboardId,
} from "@/features/dashboards/dashboard-ui-persistence";
import { saveLastWorkspaceMode } from "@/features/workspace/workspace-ui-persistence";
import { resolveWorkspaceFallback } from "@/features/workspace/workspace-utils";
import { cn } from "@/lib/utils";

import {
	clampSidebarWidth,
	connectionHeadline,
	engineLabel,
	useAppState,
} from "@/hooks/useAppState";
import type { MainWorkspaceId } from "@/features/workspace/types";

// Heavy surfaces load on first use so the query editor starts fast.
const AskVeloxySidebar = lazy(() =>
	import("@/features/queries/components/AskVeloxyDialog").then((m) => ({ default: m.AskVeloxySidebar })),
);
const DashboardWorkspace = lazy(() =>
	import("@/features/dashboards/components/DashboardWorkspace").then((m) => ({ default: m.DashboardWorkspace })),
);
const ModelWorkspace = lazy(() =>
	import("@/features/model/components/ModelWorkspace").then((m) => ({ default: m.ModelWorkspace })),
);
const ChartBuilderDialog = lazy(() =>
	import("@/features/dashboards/components/ChartBuilderDialog").then((m) => ({ default: m.ChartBuilderDialog })),
);
const GenerateDashboardDialog = lazy(() =>
	import("@/features/dashboards/components/GenerateDashboardDialog").then((m) => ({ default: m.GenerateDashboardDialog })),
);

export function VeloxApp() {
	const { t } = useTranslation();
	const queryWorkspaceRef = useRef<import("@/features/queries/components/QueryWorkspace").QueryWorkspaceHandle>(null);

	const queryClient = useQueryClient();
	const app = useAppState(queryWorkspaceRef);
	const veloxyBaseUrl = useSettings((s) => s.veloxyBaseUrl);
	const veloxyProvider = useSettings((s) => s.veloxyProvider);
	const [saveQueryDialog, setSaveQueryDialog] = useState<{ sql: string; connectionId: string | null } | null>(null);
	const [generateDashboardOpen, setGenerateDashboardOpen] = useState(false);
	const [chartBuilderDialog, setChartBuilderDialog] = useState<{
		openKey: string;
		sql: string;
		connectionId: string;
		preferredDashboardId?: string | null;
		defaultChartType?: BuilderChartType;
		defaultTitle?: string;
		defaultEncodings?: ChartEncodings;
	} | null>(null);
	const pendingSqlToOpenRef = useRef<string | null>(null);
	const [openDashboardId, setOpenDashboardId] = useState<string | null>(null);
	const [isVeloxyOpen, setIsVeloxyOpen] = useState(loadVeloxyDrawerOpen);
	const [veloxyWidth, setVeloxyWidth] = useState(loadVeloxyDrawerWidth);
	const [pendingFixContext, setPendingFixContext] = useState<VeloxyFixErrorContext | null>(null);
	const [pendingChartContext, setPendingChartContext] = useState<VeloxyChartContext | null>(null);

	useEffect(() => {
		saveVeloxyDrawerOpen(isVeloxyOpen);
	}, [isVeloxyOpen]);

	useEffect(() => {
		saveVeloxyDrawerWidth(veloxyWidth);
	}, [veloxyWidth]);

	const handleVeloxyResizeStart = (event: ReactPointerEvent<HTMLDivElement>) => {
		event.preventDefault();
		const startX = event.clientX;
		const startWidth = veloxyWidth;
		const handlePointerMove = (moveEvent: PointerEvent) => {
			const delta = moveEvent.clientX - startX;
			setVeloxyWidth(clampVeloxyWidth(startWidth - delta));
		};
		const handlePointerUp = () => {
			window.removeEventListener("pointermove", handlePointerMove);
			window.removeEventListener("pointerup", handlePointerUp);
		};
		window.addEventListener("pointermove", handlePointerMove);
		window.addEventListener("pointerup", handlePointerUp);
	};

	useAppHotkey("toggleAskVeloxy", () => {
		if (!app.connection) {
			app.setConnectionDialogOpen(true);
			return;
		}
		setIsVeloxyOpen((prev) => !prev);
	});

	const {
		connection,
		focusedQueryCaps,
		tableSearch, setTableSearch,
		selectedTable,
		settingsOpen, setSettingsOpen,
		commandPaletteOpen, setCommandPaletteOpen,
		connectionDialogOpen, setConnectionDialogOpen,
		renamingConnection,
		isSidebarCollapsed, setIsSidebarCollapsed,
		sidebarWidth, setSidebarWidth,
		resultsHeight, setResultsHeight,
		tablePropertiesDialogOpen, setTablePropertiesDialogOpen,
		tablePropertiesTarget,
		insertRowTrigger,
		mainWorkspace, setMainWorkspace,
		isDark,
		veloxyModel,
		veloxyApiKey,
		connectionsQuery, tablesQuery, schemaQuery,
		saveResultEditsMutation,
		connectMutation,
		tablesForUi,
		connectionError, connectionErrorMessage,
		connectionsErrorMessage, tablesErrorMessage,
		schemaErrorMessage,
		primaryKeyColumns, editableColumns,
		isResultSingleTableEditable, saveDisabledReason,
		handleSelectTable,
		handlePreviewTable,
		handleTableQuickAction,
		handleSelectConnection,
		handleRefreshConnection,
		handleRefreshTable,
		handleRenameTableRequest,
		handleDeleteTableRequest,
		handleRenameConnectionRequest,
		handleRenameConnectionConfirm,
		handleDisconnectConnectionRequest,
		handleCopyConnectionString,
		handleTruncateTable,
		handleCopyTableName,
		handleCopyTableSql,
		handleRefreshDatabases,
		handleCopyDatabaseName,
		handleActivateConnectionForTab,
		handleSaveResultEdits,
		handleDeleteRows,
		requestInsertRow,
		handleInsertRowSuccess,
		activateConnectionMutation,
	} = app;

	const [settingsTab, setSettingsTab] = useState<SettingsTabId>("appearance");
	/** Opens Settings, optionally on a given page (AI prompts open "veloxy"). */
	const openSettings = (tab?: SettingsTabId) => {
		if (tab) setSettingsTab(tab);
		setSettingsOpen(true);
	};

	// Mount the dashboard and model workspaces the first time they are opened,
	// then keep them mounted (hidden) so switching back keeps their state.
	const [mountedWorkspaces, setMountedWorkspaces] = useState(() => new Set<MainWorkspaceId>([mainWorkspace]));
	if (!mountedWorkspaces.has(mainWorkspace)) {
		setMountedWorkspaces(new Set([...mountedWorkspaces, mainWorkspace]));
	}

	const openDashboardIdRef = useRef<string | null>(null);
	useEffect(() => {
		openDashboardIdRef.current = openDashboardId;
	}, [openDashboardId]);

	const handleSidebarResizeStart = (event: ReactPointerEvent<HTMLDivElement>) => {
		const startX = event.clientX;
		const startWidth = sidebarWidth;
		const handlePointerMove = (moveEvent: PointerEvent) => {
			setSidebarWidth(clampSidebarWidth(startWidth + moveEvent.clientX - startX));
		};
		const handlePointerUp = () => {
			window.removeEventListener("pointermove", handlePointerMove);
			window.removeEventListener("pointerup", handlePointerUp);
		};
		window.addEventListener("pointermove", handlePointerMove);
		window.addEventListener("pointerup", handlePointerUp);
	};

	useAppHotkey("commandPalette", () => {
		setCommandPaletteOpen(true);
	});

	useAppHotkey("newConnection", () => {
		setConnectionDialogOpen(true);
	});

	useEffect(() => {
		if (mainWorkspace === "query" && pendingSqlToOpenRef.current !== null) {
			queryWorkspaceRef.current?.openTabWithSql(pendingSqlToOpenRef.current);
			pendingSqlToOpenRef.current = null;
		}
	}, [mainWorkspace]);


	useEffect(() => {
		const fallback = resolveWorkspaceFallback(mainWorkspace, { showDashboardTab: true, connection });
		if (!fallback) return;
		setMainWorkspace(fallback);
		if (connection) saveLastWorkspaceMode(connection.id, fallback);
	}, [mainWorkspace, connection, setMainWorkspace]);

	const handleOpenDashboard = useCallback((dashboardId: string) => {
		void (async () => {
			let dashboard = queryClient.getQueryData<Dashboard | null | undefined>(
				queryKeys.dashboard(dashboardId),
			);
			if (!dashboard) {
				dashboard = await veloxDbRepository.getDashboard(dashboardId) ?? undefined;
			}
			if (dashboard) {
				saveLastDashboardId(dashboard.connectionId, dashboardId);
				if (connection?.id !== dashboard.connectionId) {
					activateConnectionMutation.mutate(dashboard.connectionId);
				}
			}
			setOpenDashboardId(dashboardId);
		})();
	}, [queryClient, connection?.id, activateConnectionMutation]);

	const handleWorkspaceChange = useCallback((next: MainWorkspaceId) => {
		setMainWorkspace(next);
		if (connection) saveLastWorkspaceMode(connection.id, next);
		if (next === "dashboard" && !openDashboardIdRef.current) {
			const globalLast = loadGlobalLastDashboardId();
			if (globalLast) handleOpenDashboard(globalLast);
		}
	}, [connection, setMainWorkspace, handleOpenDashboard]);

	const handleOpenChartBuilder = (options: {
		sql?: string;
		connectionId?: string;
		preferredDashboardId?: string | null;
		defaultChartType?: BuilderChartType;
		defaultTitle?: string;
		defaultEncodings?: ChartEncodings;
	}) => {
		const chartConnectionId = options.connectionId ?? connection?.id;
		if (!chartConnectionId) return;
		setChartBuilderDialog({
			openKey: crypto.randomUUID(),
			sql: options.sql ?? "",
			connectionId: chartConnectionId,
			preferredDashboardId: options.preferredDashboardId ?? openDashboardId,
			defaultChartType: options.defaultChartType,
			defaultTitle: options.defaultTitle,
			defaultEncodings: options.defaultEncodings,
		});
	};

	const openGenerateDashboard = () => {
		setGenerateDashboardOpen(true);
	};

	const handleOpenSqlInEditor = useCallback(({ sql, connectionId }: OpenSqlInEditorOptions) => {
		const openSql = () => {
			pendingSqlToOpenRef.current = sql;
			setMainWorkspace("query");
			if (connection) saveLastWorkspaceMode(connection.id, "query");
		};

		if (connection?.id === connectionId) {
			openSql();
			return;
		}

		activateConnectionMutation.mutate(connectionId, { onSuccess: openSql });
	}, [connection, activateConnectionMutation, setMainWorkspace]);

	const layoutStyle = {
		"--sidebar-width": `${isSidebarCollapsed ? 0 : sidebarWidth}px`,
	} as CSSProperties;

	return (
		<div className="flex h-screen overflow-hidden bg-background text-foreground" style={layoutStyle}>
			<ActivityRail
				mainWorkspace={mainWorkspace}
				onChange={handleWorkspaceChange}
				showModel={connection?.engine === "postgres"}
				showDashboard
			/>

			{!isSidebarCollapsed ? (
				<>
					<div className="min-w-0 shrink-0" style={{ width: "var(--sidebar-width)" }}>
						<ErrorBoundary fallback={<div className="px-3 py-4 text-xs text-destructive">Sidebar failed to render.</div>}>
							{connectionsQuery.isError && mainWorkspace !== "dashboard" ? (
								<div className="px-3 py-4 text-xs text-destructive">{connectionsErrorMessage}</div>
							) : (
								<ContextSidebar
									mainWorkspace={mainWorkspace}
									connectionsSidebarProps={{
										activeConnection: connection,
										connections: connectionsQuery.data ?? [],
										tables: tablesForUi,
										tablesErrorMessage: tablesQuery.isError ? tablesErrorMessage : undefined,
										selectedTable,
										search: tableSearch,
										isConnectionsLoading: connectionsQuery.isLoading,
										isTablesLoading: tablesQuery.isLoading,
										isActivatingConnection: app.activateConnectionMutation.isPending,
										onSearchChange: setTableSearch,
										onOpenConnection: () => setConnectionDialogOpen(true),
										onSelectConnection: handleSelectConnection,
										onSelectTable: handleSelectTable,
										onPreviewTable: handlePreviewTable,
										onTableQuickAction: handleTableQuickAction,
										onRefreshConnection: handleRefreshConnection,
										onRefreshTable: handleRefreshTable,
										onRenameConnection: handleRenameConnectionRequest,
										onDisconnectConnection: handleDisconnectConnectionRequest,
										onRenameTable: handleRenameTableRequest,
										onDeleteTable: handleDeleteTableRequest,
										onTruncateTable: handleTruncateTable,
										onCopyTableName: handleCopyTableName,
										onCopyTableSql: handleCopyTableSql,
										onRefreshDatabases: handleRefreshDatabases,
										onCopyDatabaseName: handleCopyDatabaseName,
										onCopyConnectionString: handleCopyConnectionString,
										onDatabaseSwitched: app.setConnection,
										onToggleCollapsed: () => setIsSidebarCollapsed(true),
									}}
									dashboardSidebarProps={{
										connection,
										openDashboardId,
										onOpenDashboard: handleOpenDashboard,
										onOpenSqlInEditor: handleOpenSqlInEditor,
										onChartSavedQuery: (sql, chartConnectionId) => handleOpenChartBuilder({
											sql,
											connectionId: chartConnectionId,
											preferredDashboardId: openDashboardId,
										}),
										onOpenConnection: () => setConnectionDialogOpen(true),
										onToggleCollapsed: () => setIsSidebarCollapsed(true),
										onGenerateWithAi: openGenerateDashboard,
									}}
								/>
							)}
						</ErrorBoundary>
					</div>
					<div
						className="w-1 shrink-0 cursor-col-resize border-r border-border bg-muted/20 transition hover:bg-muted/60"
						onPointerDown={handleSidebarResizeStart}
						title="Resize sidebar"
					/>
				</>
			) : null}

			<main className="grid min-h-0 min-w-0 flex-1 grid-rows-[auto_minmax(0,1fr)]">
				<header className="min-w-0 shrink-0 overflow-x-auto border-b border-border">
					<div className="flex min-w-full w-max items-center justify-between gap-4 px-5 py-3">
						<div className="flex min-w-0 flex-1 items-center gap-3">
							{isSidebarCollapsed ? (
								<Button variant="outline" size="icon-sm" className="shrink-0"
									onClick={() => setIsSidebarCollapsed(false)} aria-label="Open sidebar">
									<SidebarSimpleIcon />
								</Button>
							) : null}
							<div className="min-w-0">
								<p className="truncate text-sm text-foreground">
									{connection ? connectionHeadline(connection) : t("workspace.chooseConnection")}
								</p>
							</div>
						</div>
						<div className="flex shrink-0 items-center gap-2">
							<ThemeSelector />
							<Button variant="outline" size="icon-sm" onClick={() => setCommandPaletteOpen(true)} title={t("sidebar.palette")}>
								<CommandIcon />
							</Button>
							<Button variant="outline" size="icon-sm" onClick={() => setSettingsOpen(true)} title={t("sidebar.settings")}>
								<GearIcon />
							</Button>
							<Button
								variant={isVeloxyOpen ? "secondary" : "outline"}
								size="sm"
								onClick={() => {
									if (!connection) {
										setConnectionDialogOpen(true);
										return;
									}
									setIsVeloxyOpen((prev) => !prev);
								}}
								title={t("veloxy.askVeloxy")}
							>
								<RobotIcon className="size-4" />
								{t("veloxy.askVeloxy")}
							</Button>
						</div>
					</div>
				</header>

				<div className="relative min-h-0 min-w-0 flex-1 overflow-hidden">
					<div className={cn("h-full w-full min-h-0 min-w-0 flex flex-col", mainWorkspace !== "query" && "hidden")}>
						<QueryWorkspace
							ref={queryWorkspaceRef}
							connectionId={connection?.id ?? null}
							connectionEngine={connection?.engine ?? null}
							connectionError={connectionError}
							connectionErrorMessage={connectionErrorMessage}
							isDark={isDark}
							onRequestConnection={() => setConnectionDialogOpen(true)}
							resultsHeight={resultsHeight}
							onResultsHeightChange={setResultsHeight}
							selectedTable={selectedTable}
							schemaLoading={schemaQuery?.isLoading ?? false}
							schemaError={schemaQuery?.isError ? schemaErrorMessage : null}
							columnCount={schemaQuery?.data?.length ?? null}
							primaryKeyColumns={primaryKeyColumns}
							editableColumns={editableColumns}
							saveDisabledReason={saveDisabledReason}
							isResultSingleTableEditable={isResultSingleTableEditable}
							saveResultEditsMutation={saveResultEditsMutation}
							onSaveResultEdits={handleSaveResultEdits}
							onDeleteRows={handleDeleteRows}
							onFocusedTabCapabilitiesChange={app.setFocusedQueryCaps}
							onActivateConnectionForTab={handleActivateConnectionForTab}
							insertRowTrigger={insertRowTrigger}
							insertConnectionId={connection?.id ?? null}
							insertTable={selectedTable}
							canInsertRow={Boolean(connection?.id && selectedTable)}
							onInsertRowSuccess={handleInsertRowSuccess}
							onOpenAddRow={connection?.id && selectedTable ? requestInsertRow : undefined}
							onSaveQuery={() => {
								setSaveQueryDialog({
									sql: queryWorkspaceRef.current?.getActiveTabSql()?.trim() ?? "",
									connectionId: queryWorkspaceRef.current?.getActiveTabConnectionId() ?? null,
								});
							}}
							onCreateChart={(sql, chartConnectionId) => {
								handleOpenChartBuilder({ sql, connectionId: chartConnectionId });
							}}
							onFixQueryError={(sql, errorMessage) => {
								setPendingFixContext({ sql, errorMessage });
								setIsVeloxyOpen(true);
							}}
							onToggleAskVeloxy={() => setIsVeloxyOpen((prev) => !prev)}
							isVeloxyOpen={isVeloxyOpen}
						/>
					</div>

					<div className={cn("h-full w-full min-h-0 min-w-0 flex flex-col", mainWorkspace !== "dashboard" && "hidden")}>
						<ErrorBoundary>
							{mountedWorkspaces.has("dashboard") ? (
								<Suspense fallback={null}>
									<DashboardWorkspace
										key={openDashboardId ?? "none"}
										openDashboardId={openDashboardId}
										isDark={isDark}
										onCloseDashboard={() => setOpenDashboardId(null)}
										onOpenChartBuilder={handleOpenChartBuilder}
										onOpenSqlInEditor={handleOpenSqlInEditor}
										onOpenConnection={() => setConnectionDialogOpen(true)}
										onGenerateWithAi={openGenerateDashboard}
										onAskVeloxyAboutWidget={(context) => {
											setPendingChartContext({
												title: context.widget.title,
												sql: context.sql,
												columns: context.columns,
												sampleRows: context.sampleRows,
												rowCount: context.rowCount,
												activeFilters: context.activeFilters,
												requestId: crypto.randomUUID(),
											});
											setIsVeloxyOpen(true);
										}}
									/>
								</Suspense>
							) : null}
						</ErrorBoundary>
					</div>

					<div className={cn("h-full w-full min-h-0 min-w-0 flex flex-col", mainWorkspace !== "model" && "hidden")}>
						{connection?.id ? (
							<ErrorBoundary>
								{connection.engine === "postgres" ? (
									mountedWorkspaces.has("model") ? (
										<Suspense fallback={null}>
											<ModelWorkspace
												key={connection.id}
												connectionId={connection.id}
												connectionEngine={connection.engine}
												defaultDatabaseName={connection.database}
												isDark={isDark}
												tables={tablesForUi}
												tablesErrorMessage={tablesQuery.isError ? tablesErrorMessage : undefined}
												isTablesLoading={tablesQuery.isLoading}
												selectedTable={selectedTable}
											/>
										</Suspense>
									) : null
								) : (
									<div className="flex h-full items-center justify-center px-6 text-center text-sm text-muted-foreground">
										{t("model.postgresOnly", { engine: engineLabel(connection.engine) })}
									</div>
								)}
							</ErrorBoundary>
						) : (
							<div className="flex flex-1 h-full flex-col items-center justify-center gap-3 px-6 text-center">
								<p className="text-sm text-muted-foreground">{t("model.connectToUse")}</p>
								<Button size="sm" onClick={() => setConnectionDialogOpen(true)}>
									{t("model.connectToUseAction")}
								</Button>
							</div>
						)}
					</div>
				</div>

			</main>

			{isVeloxyOpen && connection ? (
				<>
					<div
						className="w-1 shrink-0 cursor-col-resize border-x border-border/60 bg-muted/20 transition-colors hover:bg-muted/60"
						onPointerDown={handleVeloxyResizeStart}
						title="Resize Veloxy copilot"
					/>
					<aside
						className="h-full min-h-0 min-w-0 shrink-0 overflow-hidden border-l border-border bg-background motion-safe:animate-veloxy-drawer motion-reduce:animate-none"
						style={{ width: veloxyWidth }}
					>
						<Suspense fallback={null}>
							<AskVeloxySidebar
								key={connection.id}
								connectionId={connection.id}
								engine={connection.engine}
								databaseName={connection.database}
								selectedTable={selectedTable}
								connections={connectionsQuery.data ?? []}
								onSelectConnection={(id) => {
									const target = (connectionsQuery.data ?? []).find((c) => c.id === id);
									if (target) handleSelectConnection(target);
								}}
								onNewConnection={() => setConnectionDialogOpen(true)}
								activeWorkspace={mainWorkspace}
								modelLabel={veloxyModel}
								apiKey={veloxyApiKey}
								isConfigured={isVeloxyConfigured({
									provider: veloxyProvider,
									apiKey: veloxyApiKey,
									model: veloxyModel,
									baseUrl: veloxyBaseUrl,
								})}
								fixErrorContext={pendingFixContext}
								onClearFixErrorContext={() => setPendingFixContext(null)}
								chartContext={pendingChartContext}
								onClearChartContext={() => setPendingChartContext(null)}
								onClose={() => setIsVeloxyOpen(false)}
								onOpenSettings={() => openSettings("veloxy")}
								onConfirmRun={async (sql) => {
									if (mainWorkspace !== "query") {
										handleWorkspaceChange("query");
									}
									queryWorkspaceRef.current?.openTabWithSqlAndRun(sql);
								}}
								onInsertSql={(sql) => {
									if (mainWorkspace !== "query") {
										handleWorkspaceChange("query");
									}
									queryWorkspaceRef.current?.appendQuerySql(sql);
								}}
								onReplaceSql={(sql) => {
									if (mainWorkspace !== "query") {
										handleWorkspaceChange("query");
									}
									queryWorkspaceRef.current?.replaceQuerySql(sql);
								}}
								onOpenTabWithSql={(sql) => {
									if (mainWorkspace !== "query") {
										handleWorkspaceChange("query");
									}
									queryWorkspaceRef.current?.openTabWithSql(sql);
								}}
								onPinToDashboard={({ sql, title, defaultChartType, defaultEncodings }) => {
									handleOpenChartBuilder({
										sql,
										connectionId: connection.id,
										defaultChartType,
										defaultTitle: title,
										defaultEncodings,
									});
								}}
							/>
						</Suspense>
					</aside>
				</>
			) : null}

			<ConnectionDialog
				open={connectionDialogOpen}
				onOpenChange={setConnectionDialogOpen}
				onSubmit={(values) => { connectMutation.mutate(values); }}
				isPending={connectMutation.isPending}
			/>
			<RenameConnectionDialog
				key={renamingConnection?.id ?? "none"}
				connection={renamingConnection}
				onConfirm={handleRenameConnectionConfirm}
				onCancel={() => app.setRenamingConnection(null)}
			/>
			<SaveQueryDialog
				open={saveQueryDialog !== null}
				onOpenChange={(open) => { if (!open) setSaveQueryDialog(null); }}
				sql={saveQueryDialog?.sql ?? ""}
				connectionId={saveQueryDialog?.connectionId ?? null}
			/>
			{chartBuilderDialog ? (
				<Suspense fallback={null}>
					<ChartBuilderDialog
						key={chartBuilderDialog.openKey}
						open
						onOpenChange={(open) => { if (!open) setChartBuilderDialog(null); }}
						connectionId={chartBuilderDialog.connectionId}
						sql={chartBuilderDialog.sql}
						isDark={isDark}
						preferredDashboardId={chartBuilderDialog.preferredDashboardId}
						defaultChartType={chartBuilderDialog.defaultChartType}
						defaultTitle={chartBuilderDialog.defaultTitle}
						defaultEncodings={chartBuilderDialog.defaultEncodings}
						onChartCreated={(dashboardId) => {
							setChartBuilderDialog(null);
							handleOpenDashboard(dashboardId);
							handleWorkspaceChange("dashboard");
						}}
					/>
				</Suspense>
			) : null}
			<TablePropertiesDialog
				open={tablePropertiesDialogOpen}
				onOpenChange={(nextOpen) => {
					setTablePropertiesDialogOpen(nextOpen);
					if (!nextOpen) app.setTablePropertiesTarget(null);
				}}
				connectionId={tablePropertiesTarget?.connectionId}
				tablePropertyEditingSupported={connection?.tablePropertyEditingSupported}
				table={tablePropertiesTarget?.table ?? null}
			/>
			<CommandPalette
				open={commandPaletteOpen}
				onOpenChange={setCommandPaletteOpen}
				tables={tablesForUi}
				hasLastQuery={focusedQueryCaps.hasLastQuery}
				onOpenConnection={() => setConnectionDialogOpen(true)}
				onRunLastQuery={() => { queryWorkspaceRef.current?.runLastQuery(); }}
				onSelectTable={handleSelectTable}
				onSwitchToQuery={() => handleWorkspaceChange("query")}
				onSwitchToModel={connection?.engine === "postgres" ? () => handleWorkspaceChange("model") : undefined}
				onSwitchToDashboard={() => handleWorkspaceChange("dashboard")}
				onOpenSettings={() => setSettingsOpen(true)}
				onToggleVeloxy={() => {
					if (!connection) {
						setConnectionDialogOpen(true);
						return;
					}
					setIsVeloxyOpen((prev) => !prev);
				}}
				onCreateChartFromLastResult={() => {
					const sql = queryWorkspaceRef.current?.getActiveTabLastExecutedSql();
					const chartConnectionId = queryWorkspaceRef.current?.getActiveTabConnectionId();
					if (sql && chartConnectionId) handleOpenChartBuilder({ sql, connectionId: chartConnectionId });
				}}
				canCreateChartFromLastResult={
					focusedQueryCaps.hasLastQuery
					&& Boolean(connection?.engine && canUseDashboards(connection.engine))
				}
				onGenerateDashboardWithAi={openGenerateDashboard}
			/>
			<ShortcutSheet />
			<SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} tab={settingsTab} onTabChange={setSettingsTab} />
			{generateDashboardOpen ? (
				<Suspense fallback={null}>
					<GenerateDashboardDialog
						open={generateDashboardOpen}
						onOpenChange={setGenerateDashboardOpen}
						connectionId={connection?.id ?? null}
						onDashboardCreated={(dashboard) => {
							handleOpenDashboard(dashboard.id);
							handleWorkspaceChange("dashboard");
						}}
						onOpenSettings={() => openSettings("veloxy")}
					/>
				</Suspense>
			) : null}
		</div>
	);
}
