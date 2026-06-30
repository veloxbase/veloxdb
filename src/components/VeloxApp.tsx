import { GearIcon, RobotIcon, SidebarSimpleIcon } from "@phosphor-icons/react";
import {
	type CSSProperties,
	type PointerEvent as ReactPointerEvent,
	useEffect,
	useRef,
} from "react";
import { useTranslation } from "react-i18next";

import { ErrorBoundary } from "@/components/ErrorBoundary";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CommandPalette } from "@/features/commands/components/CommandPalette";
import { ShortcutSheet } from "@/features/commands/components/ShortcutSheet";
import { SettingsDialog } from "@/features/commands/components/SettingsDialog";
import { ConnectionDialog } from "@/features/connections/components/ConnectionDialog";
import { RenameConnectionDialog } from "@/features/connections/components/RenameConnectionDialog";
import { ConnectionsSidebarTree } from "@/features/connections/components/ConnectionsSidebarTree";
import { QueryWorkspace } from "@/features/queries/components/QueryWorkspace";
import { AskVeloxySidebar } from "@/features/queries/components/AskVeloxyDialog";
import { ModelWorkspace } from "@/features/model/components/ModelWorkspace";
import { TablePropertiesDialog } from "@/features/schema/components/TablePropertiesDialog";

import {
	clampSidebarWidth,
	connectionHeadline,
	engineLabel,
	useAppState,
} from "@/hooks/useAppState";

export function VeloxApp() {
	const { t } = useTranslation();
	const queryWorkspaceRef = useRef<import("@/features/queries/components/QueryWorkspace").QueryWorkspaceHandle>(null);

	const app = useAppState(queryWorkspaceRef);

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
		askVeloxyPending,
		askVeloxyError,
		isDark,
		veloxyModel,
		veloxyOpenRouterApiKey,
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
		handleRefreshDatabases,
		handleCopyDatabaseName,
		handleActivateConnectionForTab,
		handleSaveResultEdits,
		handleDeleteRows,
		requestInsertRow,
		handleInsertRowSuccess,
		handleAskVeloxyChatSubmit,
		handleCancelVeloxyRequest,
		handleAskVeloxyActionSubmit,
		handleLoadVeloxyConversation,
		handleClearVeloxyConversation,
	} = app;

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

	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			const commandKey = event.metaKey || event.ctrlKey;
			if (commandKey && event.key.toLowerCase() === "p") {
				event.preventDefault();
				setCommandPaletteOpen(true);
			}
			if (commandKey && event.shiftKey && event.key.toLowerCase() === "c") {
				event.preventDefault();
				setConnectionDialogOpen(true);
			}
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [setCommandPaletteOpen, setConnectionDialogOpen]);

	const layoutStyle = {
		"--sidebar-width": `${isSidebarCollapsed ? 0 : sidebarWidth}px`,
	} as CSSProperties;

	return (
		<div className="flex h-screen overflow-hidden bg-background text-foreground" style={layoutStyle}>
			{!isSidebarCollapsed ? (
				<>
					<div className="min-w-0 shrink-0" style={{ width: "var(--sidebar-width)" }}>
						<ErrorBoundary fallback={<div className="px-3 py-4 text-xs text-destructive">Sidebar failed to render.</div>}>
							{connectionsQuery.isError ? (
								<div className="px-3 py-4 text-xs text-destructive">{connectionsErrorMessage}</div>
							) : (
								<ConnectionsSidebarTree
									activeConnection={connection}
									connections={connectionsQuery.data ?? []}
									tables={tablesForUi}
									tablesErrorMessage={tablesQuery.isError ? tablesErrorMessage : undefined}
									selectedTable={selectedTable}
									search={tableSearch}
									isConnectionsLoading={connectionsQuery.isLoading}
									isTablesLoading={tablesQuery.isLoading}
									isActivatingConnection={app.activateConnectionMutation.isPending}
									onSearchChange={setTableSearch}
									onOpenConnection={() => setConnectionDialogOpen(true)}
									onSelectConnection={handleSelectConnection}
									onSelectTable={handleSelectTable}
									onTableQuickAction={handleTableQuickAction}
									onRefreshConnection={handleRefreshConnection}
									onRefreshTable={handleRefreshTable}
									onRenameConnection={handleRenameConnectionRequest}
									onDisconnectConnection={handleDisconnectConnectionRequest}
									onRenameTable={handleRenameTableRequest}
									onDeleteTable={handleDeleteTableRequest}
									onTruncateTable={handleTruncateTable}
									onCopyTableName={handleCopyTableName}
									onRefreshDatabases={handleRefreshDatabases}
									onCopyDatabaseName={handleCopyDatabaseName}
									onCopyConnectionString={handleCopyConnectionString}
									onDatabaseSwitched={app.setConnection}
									onToggleCollapsed={() => setIsSidebarCollapsed(true)}
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
							<Tabs value={mainWorkspace}
								onValueChange={(value) => setMainWorkspace(value as "query" | "model")} className="shrink-0">
								<TabsList variant="line" className="h-8">
									<TabsTrigger value="query" className="text-xs">{t("workspace.query")}</TabsTrigger>
									<TabsTrigger value="model" className="text-xs"
										disabled={Boolean(connection && connection.engine !== "postgres")}>
										{t("workspace.model")}
									</TabsTrigger>
								</TabsList>
							</Tabs>
							<div className="min-w-0">
								<p className="text-[11px] uppercase tracking-[0.24em] text-muted-foreground">VeloxDB.dev</p>
								<p className="truncate text-sm text-foreground">
									{connection ? connectionHeadline(connection) : t("workspace.chooseConnection")}
								</p>
							</div>
						</div>
						<div className="flex shrink-0 items-center gap-2">
							<Button variant="outline" size="icon-sm" onClick={() => setCommandPaletteOpen(true)} title={t("sidebar.palette")}>
								<SidebarSimpleIcon />
							</Button>
							<Button variant="outline" size="icon-sm" onClick={() => setSettingsOpen(true)} title={t("sidebar.settings")}>
								<GearIcon />
							</Button>
							<Button
								variant="outline"
								size="sm"
								onClick={() => queryWorkspaceRef.current?.toggleAskVeloxy()}
								disabled={!connection}
								title={t("veloxy.askVeloxy")}
							>
								<RobotIcon className="size-4" />
								{t("veloxy.askVeloxy")}
							</Button>
						</div>
					</div>
				</header>

				{mainWorkspace === "query" ? (
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
						askVeloxySidebar={(onClose) => (
							<AskVeloxySidebar
								isPending={askVeloxyPending}
								modelLabel={veloxyModel}
								contextTableLabel={selectedTable ? `${selectedTable.schema}.${selectedTable.name}` : null}
								isConfigured={Boolean(veloxyOpenRouterApiKey.trim() && veloxyModel.trim())}
								onClose={onClose}
								onOpenSettings={() => { setSettingsOpen(true); }}
								onChatSubmit={handleAskVeloxyChatSubmit}
								onActionSubmit={handleAskVeloxyActionSubmit}
								onLoadConversation={handleLoadVeloxyConversation}
								onClearConversation={handleClearVeloxyConversation}
								onConfirmRun={async (sql) => {
									queryWorkspaceRef.current?.openTabWithSqlAndRun(sql);
								}}
								onInsertSql={(sql) => { queryWorkspaceRef.current?.appendQuerySql(sql); }}
								onReplaceSql={(sql) => { queryWorkspaceRef.current?.replaceQuerySql(sql); }}
								onOpenTabWithSql={(sql) => { queryWorkspaceRef.current?.openTabWithSql(sql); }}
								onCancelRequest={handleCancelVeloxyRequest}
								errorMessage={askVeloxyError}
							/>
						)}
					/>
				) : connection?.id ? (
					<ErrorBoundary>
						{connection.engine === "postgres" ? (
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
						) : (
							<div className="flex h-full items-center justify-center px-6 text-center text-sm text-muted-foreground">
								{t("model.postgresOnly", { engine: engineLabel(connection.engine) })}
							</div>
						)}
					</ErrorBoundary>
				) : (
					<div className="flex flex-1 items-center justify-center px-6 text-center text-sm text-muted-foreground">
						{t("model.connectToUse")}
					</div>
				)}
			</main>

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
			/>
			<ShortcutSheet />
			<SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
		</div>
	);
}
