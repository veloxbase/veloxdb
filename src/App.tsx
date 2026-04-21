import { MoonIcon, SidebarSimpleIcon, SunIcon } from "@phosphor-icons/react";
import {
	type CSSProperties,
	type PointerEvent as ReactPointerEvent,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";

import { ErrorBoundary } from "@/components/ErrorBoundary";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { ConnectionSummary, TableInfo } from "@/data/types";
import { CommandPalette } from "@/features/commands/components/CommandPalette";
import { ConnectionDialog } from "@/features/connections/components/ConnectionDialog";
import { ConnectionsSidebarTree } from "@/features/connections/components/ConnectionsSidebarTree";
import {
	useActivateConnectionMutation,
	useConnectionsQuery,
	useConnectMutation,
} from "@/features/connections/queries";
import { ModelWorkspace } from "@/features/model/components/ModelWorkspace";
import { readOnboardingCompleted } from "@/features/onboarding/constants";
import { OnboardingFlow } from "@/features/onboarding/OnboardingFlow";
import {
	QueryWorkspace,
	type QueryWorkspaceHandle,
} from "@/features/queries/components/QueryWorkspace";
import { useSaveResultEditsMutation } from "@/features/queries/queries";
import type { ResultEditPatch } from "@/features/queries/result-edits";
import { TablePropertiesDialog } from "@/features/schema/components/TablePropertiesDialog";
import {
	useTablePropertiesQuery,
	useTableSchemaQuery,
} from "@/features/schema/queries";
import { useTablesQuery } from "@/features/tables/queries";

const SIDEBAR_WIDTH_KEY = "veloxdb.sidebarWidth";
const SIDEBAR_COLLAPSED_KEY = "veloxdb.sidebarCollapsed";
const RESULTS_HEIGHT_KEY = "veloxdb.resultsHeight";
const LAST_ACTIVE_CONNECTION_KEY = "veloxdb.lastActiveConnectionId";
const DEFAULT_SIDEBAR_WIDTH = 280;
const MIN_SIDEBAR_WIDTH = 220;
const MAX_SIDEBAR_WIDTH = 520;
const DEFAULT_RESULTS_HEIGHT = 260;

function clampSidebarWidth(value: number) {
	return Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, value));
}

function readSidebarWidth() {
	const value = Number(window.localStorage.getItem(SIDEBAR_WIDTH_KEY));
	return Number.isFinite(value)
		? clampSidebarWidth(value)
		: DEFAULT_SIDEBAR_WIDTH;
}

function readSidebarCollapsed() {
	return window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "true";
}

function readResultsHeight() {
	const value = Number(window.localStorage.getItem(RESULTS_HEIGHT_KEY));
	return Number.isFinite(value) && value > 0 ? value : DEFAULT_RESULTS_HEIGHT;
}

function persistLastActiveConnectionId(connectionId: string) {
	window.localStorage.setItem(LAST_ACTIVE_CONNECTION_KEY, connectionId);
}

function VeloxApp() {
	const [connection, setConnection] = useState<ConnectionSummary | null>(null);
	const queryWorkspaceRef = useRef<QueryWorkspaceHandle>(null);
	const [focusedQueryCaps, setFocusedQueryCaps] = useState({
		hasLastQuery: false,
		hasResult: false,
	});
	const [tableSearch, setTableSearch] = useState("");
	const [selectedTable, setSelectedTable] = useState<TableInfo | null>(null);
	const [isDark, setIsDark] = useState(
		() => window.matchMedia("(prefers-color-scheme: dark)").matches,
	);
	const [connectionDialogOpen, setConnectionDialogOpen] = useState(false);
	const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
	const [isSidebarCollapsed, setIsSidebarCollapsed] =
		useState(readSidebarCollapsed);
	const [sidebarWidth, setSidebarWidth] = useState(readSidebarWidth);
	const [resultsHeight, setResultsHeight] = useState(readResultsHeight);
	const [tablePropertiesDialogOpen, setTablePropertiesDialogOpen] =
		useState(false);
	const [tablePropertiesTarget, setTablePropertiesTarget] = useState<{
		connectionId: string;
		table: TableInfo;
	} | null>(null);
	const [mainWorkspace, setMainWorkspace] = useState<"query" | "model">(
		"query",
	);

	useEffect(() => {
		document.documentElement.classList.toggle("dark", isDark);
	}, [isDark]);

	useEffect(() => {
		window.localStorage.setItem(
			SIDEBAR_COLLAPSED_KEY,
			String(isSidebarCollapsed),
		);
	}, [isSidebarCollapsed]);

	useEffect(() => {
		window.localStorage.setItem(SIDEBAR_WIDTH_KEY, String(sidebarWidth));
	}, [sidebarWidth]);

	useEffect(() => {
		window.localStorage.setItem(RESULTS_HEIGHT_KEY, String(resultsHeight));
	}, [resultsHeight]);

	const connectionsQuery = useConnectionsQuery();

	const connectMutation = useConnectMutation({
		onSuccess: (nextConnection) => {
			persistLastActiveConnectionId(nextConnection.id);
			setConnection(nextConnection);
			setSelectedTable(null);
			setTableSearch("");
			setIsSidebarCollapsed(false);
			setConnectionDialogOpen(false);
			setTablePropertiesDialogOpen(false);
			setTablePropertiesTarget(null);
			queueMicrotask(() => {
				queryWorkspaceRef.current?.setActiveTabConnection(nextConnection.id);
			});
		},
	});

	const activateConnectionMutation = useActivateConnectionMutation({
		onSuccess: (nextConnection) => {
			persistLastActiveConnectionId(nextConnection.id);
			setConnection(nextConnection);
			setSelectedTable(null);
			setTableSearch("");
			setTablePropertiesDialogOpen(false);
			setTablePropertiesTarget(null);
			queueMicrotask(() => {
				queryWorkspaceRef.current?.setActiveTabConnection(nextConnection.id);
			});
		},
	});

	const connectionRestoreAttemptedRef = useRef(false);

	useEffect(() => {
		if (connectionRestoreAttemptedRef.current) return;
		const list = connectionsQuery.data;
		if (!list?.length) return;
		if (connection) {
			connectionRestoreAttemptedRef.current = true;
			return;
		}

		const savedId = window.localStorage.getItem(LAST_ACTIVE_CONNECTION_KEY);
		if (!savedId) {
			connectionRestoreAttemptedRef.current = true;
			return;
		}

		const match = list.find((c) => c.id === savedId);
		const target = match ?? list[0];
		if (!target) {
			connectionRestoreAttemptedRef.current = true;
			return;
		}

		connectionRestoreAttemptedRef.current = true;
		activateConnectionMutation.mutate(target.id);
	}, [connectionsQuery.data, connection, activateConnectionMutation]);

	const tablesQuery = useTablesQuery(connection?.id);

	const schemaQuery = useTableSchemaQuery({
		connectionId: connection?.id,
		table: selectedTable,
		enabled: Boolean(connection?.id && selectedTable),
	});
	const tablePropertiesQuery = useTablePropertiesQuery({
		connectionId: connection?.id,
		table: selectedTable,
		enabled: Boolean(connection?.id && selectedTable),
	});
	const saveResultEditsMutation = useSaveResultEditsMutation();

	const connectionsErrorMessage =
		connectionsQuery.error instanceof Error
			? connectionsQuery.error.message
			: "Failed to load saved connections";

	const tablesErrorMessage =
		tablesQuery.error instanceof Error
			? tablesQuery.error.message
			: "Failed to load tables";

	const schemaErrorMessage =
		schemaQuery.error instanceof Error
			? schemaQuery.error.message
			: "Failed to load table schema";
	const tablePropertiesErrorMessage =
		tablePropertiesQuery.error instanceof Error
			? tablePropertiesQuery.error.message
			: "Failed to load table properties";

	const tablesForUi = tablesQuery.data ?? [];

	const handleSelectTable = (table: TableInfo) => {
		setSelectedTable(table);
		queryWorkspaceRef.current?.applyTablePreview(table.previewQuery);
	};

	const handleOpenTableProperties = (
		connectionId: string,
		table: TableInfo,
	) => {
		setTablePropertiesTarget({ connectionId, table });
		setTablePropertiesDialogOpen(true);
	};

	const handleSelectConnection = (nextConnection: ConnectionSummary) => {
		if (connection?.id === nextConnection.id) {
			return;
		}

		activateConnectionMutation.mutate(nextConnection.id);
	};

	const handleActivateConnectionForTab = useCallback(
		(connectionId: string) => {
			if (connection?.id === connectionId) {
				return;
			}
			activateConnectionMutation.mutate(connectionId);
		},
		[connection?.id, activateConnectionMutation],
	);

	const handleSidebarResizeStart = (
		event: ReactPointerEvent<HTMLDivElement>,
	) => {
		const startX = event.clientX;
		const startWidth = sidebarWidth;

		const handlePointerMove = (moveEvent: PointerEvent) => {
			setSidebarWidth(
				clampSidebarWidth(startWidth + moveEvent.clientX - startX),
			);
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
	}, []);

	const layoutStyle = {
		"--sidebar-width": `${isSidebarCollapsed ? 0 : sidebarWidth}px`,
	} as CSSProperties;

	const connectionError =
		connectMutation.error ?? activateConnectionMutation.error;
	const connectionErrorMessage =
		connectionError instanceof Error
			? connectionError.message
			: "Failed to connect";
	const primaryKeyColumns =
		tablePropertiesQuery.data
			?.filter((column) => column.isPrimaryKey)
			.map((column) => column.columnName) ?? [];
	const editableColumns =
		tablePropertiesQuery.data
			?.filter((column) => !column.isPrimaryKey)
			.map((column) => column.columnName) ?? [];
	const hasSelectedTable = Boolean(selectedTable);
	const hasQueryResult = focusedQueryCaps.hasResult;
	const hasPrimaryKey = primaryKeyColumns.length > 0;
	const isResultSingleTableEditable =
		hasSelectedTable &&
		hasQueryResult &&
		hasPrimaryKey &&
		!tablePropertiesQuery.isError;
	const saveDisabledReason = !hasSelectedTable
		? "Select a table to enable row editing."
		: !hasQueryResult
			? "Run a query to edit rows."
			: tablePropertiesQuery.isLoading
				? "Loading table metadata..."
				: tablePropertiesQuery.isError
					? tablePropertiesErrorMessage
					: !hasPrimaryKey
						? "Editing requires a primary key on the selected table."
						: undefined;

	const handleSaveResultEdits = async (patches: ResultEditPatch[]) => {
		if (!selectedTable || !connection?.id || patches.length === 0) {
			return;
		}

		await saveResultEditsMutation.mutateAsync({
			connectionId: connection.id,
			table: selectedTable,
			patches,
		});

		queryWorkspaceRef.current?.refreshFocusedResults();
	};

	return (
		<div
			className="flex h-screen overflow-hidden bg-background text-foreground"
			style={layoutStyle}
		>
			{!isSidebarCollapsed ? (
				<>
					<div
						className="min-w-0 shrink-0"
						style={{ width: "var(--sidebar-width)" }}
					>
						<ErrorBoundary
							fallback={
								<div className="px-3 py-4 text-xs text-destructive">
									Sidebar failed to render.
								</div>
							}
						>
							{connectionsQuery.isError ? (
								<div className="px-3 py-4 text-xs text-destructive">
									{connectionsErrorMessage}
								</div>
							) : (
								<ConnectionsSidebarTree
									activeConnection={connection}
									connections={connectionsQuery.data ?? []}
									tables={tablesForUi}
									tablesErrorMessage={
										tablesQuery.isError ? tablesErrorMessage : undefined
									}
									selectedTable={selectedTable}
									search={tableSearch}
									isConnectionsLoading={connectionsQuery.isLoading}
									isTablesLoading={tablesQuery.isLoading}
									isActivatingConnection={activateConnectionMutation.isPending}
									onSearchChange={setTableSearch}
									onOpenConnection={() => setConnectionDialogOpen(true)}
									onSelectConnection={handleSelectConnection}
									onSelectTable={handleSelectTable}
									onOpenTableProperties={handleOpenTableProperties}
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

			<main className="grid min-w-0 flex-1 grid-rows-[auto_minmax(0,1fr)]">
				<header className="min-w-0 shrink-0 overflow-x-auto border-b border-border">
					<div className="flex min-w-full w-max items-center justify-between gap-4 px-5 py-3">
						<div className="flex min-w-0 flex-1 items-center gap-3">
							{isSidebarCollapsed ? (
								<Button
									variant="outline"
									size="icon-sm"
									className="shrink-0"
									onClick={() => setIsSidebarCollapsed(false)}
									aria-label="Open sidebar"
								>
									<SidebarSimpleIcon />
								</Button>
							) : null}

							<Tabs
								value={mainWorkspace}
								onValueChange={(value) =>
									setMainWorkspace(value as "query" | "model")
								}
								className="shrink-0"
							>
								<TabsList variant="line" className="h-8">
									<TabsTrigger value="query" className="px-2.5 text-xs">
										Query
									</TabsTrigger>
									<TabsTrigger value="model" className="px-2.5 text-xs">
										Model
									</TabsTrigger>
								</TabsList>
							</Tabs>

							<div className="min-w-0">
								<p className="text-[11px] uppercase tracking-[0.24em] text-muted-foreground">
									VeloxDB.dev
								</p>
								<p className="truncate text-sm text-foreground">
									{connection
										? `Connected to ${connection.database} on ${connection.host}:${connection.port}`
										: "Choose a saved connection or create a new one to start querying"}
								</p>
							</div>
						</div>

						<div className="flex shrink-0 items-center gap-2">
							<Button
								variant="outline"
								size="sm"
								onClick={() => setCommandPaletteOpen(true)}
							>
								<SidebarSimpleIcon />
								Palette
							</Button>
							<Button
								variant="outline"
								size="sm"
								onClick={() => setIsDark((current) => !current)}
							>
								{isDark ? <SunIcon /> : <MoonIcon />}
								{isDark ? "Light" : "Dark"}
							</Button>
						</div>
					</div>
				</header>

				{mainWorkspace === "query" ? (
					<QueryWorkspace
						ref={queryWorkspaceRef}
						connectionId={connection?.id ?? null}
						connectionError={connectionError}
						connectionErrorMessage={connectionErrorMessage}
						isDark={isDark}
						onRequestConnection={() => setConnectionDialogOpen(true)}
						resultsHeight={resultsHeight}
						onResultsHeightChange={setResultsHeight}
						selectedTable={selectedTable}
						schemaLoading={schemaQuery.isLoading}
						schemaError={schemaQuery.isError ? schemaErrorMessage : null}
						columnCount={schemaQuery.data?.length ?? null}
						primaryKeyColumns={primaryKeyColumns}
						editableColumns={editableColumns}
						saveDisabledReason={saveDisabledReason}
						isResultSingleTableEditable={isResultSingleTableEditable}
						saveResultEditsMutation={saveResultEditsMutation}
						onSaveResultEdits={handleSaveResultEdits}
						onFocusedTabCapabilitiesChange={setFocusedQueryCaps}
						onActivateConnectionForTab={handleActivateConnectionForTab}
					/>
				) : connection?.id ? (
					<ModelWorkspace
						key={connection.id}
						connectionId={connection.id}
						defaultDatabaseName={connection.database}
						isDark={isDark}
						tables={tablesForUi}
						tablesErrorMessage={
							tablesQuery.isError ? tablesErrorMessage : undefined
						}
						isTablesLoading={tablesQuery.isLoading}
						selectedTable={selectedTable}
					/>
				) : (
					<div className="flex flex-1 items-center justify-center px-6 text-center text-sm text-muted-foreground">
						Connect to a database to use the model workspace.
					</div>
				)}
			</main>

			<ConnectionDialog
				open={connectionDialogOpen}
				onOpenChange={setConnectionDialogOpen}
				onSubmit={async (values) => {
					await connectMutation.mutateAsync(values);
				}}
				isPending={connectMutation.isPending}
			/>

			<TablePropertiesDialog
				open={tablePropertiesDialogOpen}
				onOpenChange={(nextOpen) => {
					setTablePropertiesDialogOpen(nextOpen);
					if (!nextOpen) setTablePropertiesTarget(null);
				}}
				connectionId={tablePropertiesTarget?.connectionId}
				table={tablePropertiesTarget?.table ?? null}
			/>

			<CommandPalette
				open={commandPaletteOpen}
				onOpenChange={setCommandPaletteOpen}
				tables={tablesForUi}
				hasLastQuery={focusedQueryCaps.hasLastQuery}
				onOpenConnection={() => setConnectionDialogOpen(true)}
				onRunLastQuery={() => {
					queryWorkspaceRef.current?.runLastQuery();
				}}
				onSelectTable={handleSelectTable}
			/>
		</div>
	);
}

function App() {
	const [onboardingDone, setOnboardingDone] = useState(() =>
		readOnboardingCompleted(),
	);

	if (!onboardingDone) {
		return <OnboardingFlow onComplete={() => setOnboardingDone(true)} />;
	}

	return <VeloxApp />;
}

export default App;
