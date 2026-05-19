import { GearIcon, SidebarSimpleIcon } from "@phosphor-icons/react";
import { useQueryClient } from "@tanstack/react-query";
import {
	type CSSProperties,
	type PointerEvent as ReactPointerEvent,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";

import { ErrorBoundary } from "@/components/ErrorBoundary";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { queryKeys } from "@/data/query-keys";
import { veloxDbRepository } from "@/data/repositories";
import type {
	AskVeloxyChatResponse,
	AskVeloxyConversationResponse,
	ConnectionSummary,
	TableInfo,
} from "@/data/types";
import { CommandPalette } from "@/features/commands/components/CommandPalette";
import { ShortcutSheet } from "@/features/commands/components/ShortcutSheet";
import { SettingsDialog } from "@/features/commands/components/SettingsDialog";
import { ConnectionDialog } from "@/features/connections/components/ConnectionDialog";
import { RenameConnectionDialog } from "@/features/connections/components/RenameConnectionDialog";
import { ConnectionsSidebarTree } from "@/features/connections/components/ConnectionsSidebarTree";
import {
	useActivateConnectionMutation,
	useConnectionsQuery,
	useConnectMutation,
	useDeleteConnectionMutation,
	useRenameConnectionMutation,
} from "@/features/connections/queries";
import { ModelWorkspace } from "@/features/model/components/ModelWorkspace";
import { readOnboardingCompleted } from "@/features/onboarding/constants";
import { OnboardingFlow } from "@/features/onboarding/OnboardingFlow";
import {
	QueryWorkspace,
	type QueryWorkspaceHandle,
} from "@/features/queries/components/QueryWorkspace";
import {
	AskVeloxySidebar,
	type AskVeloxySubmitResult,
} from "@/features/queries/components/AskVeloxyDialog";
import { useSaveResultEditsMutation, useDeleteRowsMutation } from "@/features/queries/queries";
import { notifyError, notifySuccess } from "@/lib/error-notifier";
import { useSettings, resolveTheme } from "@/lib/settings";
import {
	buildDropTableSql,
	buildDeleteTemplateSql,
	buildInsertTemplateSql,
	buildRenameTableSql,
	buildSelectAllSql,
	buildSelectCountSql,
	buildUpdateTemplateSql,
} from "@/features/queries/sql-templates";
import type { TableQuickSqlAction } from "@/features/queries/table-quick-actions";
import { isInsertFormColumn, type ResultEditPatch } from "@/features/queries/result-edits";
import { quoteIdent } from "@/lib/sql-ident";
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

function connectionSecondaryText(connection: ConnectionSummary): string {
	if (connection.engine === "sqlite") {
		return connection.filePath === ":memory:"
			? "SQLite in-memory database"
			: `SQLite file: ${connection.filePath ?? connection.database}`;
	}
	return `${connection.user}@${connection.host}:${connection.port}${connection.sshConfig ? " (via SSH)" : ""}`;
}

function connectionHeadline(connection: ConnectionSummary): string {
	if (connection.engine === "sqlite") {
		return `Connected to SQLite (${connection.filePath ?? connection.database})`;
	}
	return `Connected to ${connection.database} on ${connection.host}:${connection.port}`;
}

function engineLabel(engine: ConnectionSummary["engine"]): string {
	if (engine === "postgres") return "PostgreSQL";
	if (engine === "mysql") return "MySQL";
	return "SQLite";
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
	const themeSetting = useSettings((s) => s.theme)
	const isDark = useMemo(() => resolveTheme(themeSetting) === 'dark', [themeSetting])
	const fontSize = useSettings((s) => s.fontSize)
	const [settingsOpen, setSettingsOpen] = useState(false)
	const [commandPaletteOpen, setCommandPaletteOpen] = useState(false)
	const [connectionDialogOpen, setConnectionDialogOpen] = useState(false);
	const [renamingConnection, setRenamingConnection] = useState<ConnectionSummary | null>(null);
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
	const [insertRowTrigger, setInsertRowTrigger] = useState(0);
	const [mainWorkspace, setMainWorkspace] = useState<"query" | "model">(
		"query",
	);
	const [askVeloxyPending, setAskVeloxyPending] = useState(false);
	const [askVeloxyError, setAskVeloxyError] = useState<string | null>(null);
	const veloxyOpenRouterApiKey = useSettings((s) => s.veloxyOpenRouterApiKey);
	const veloxyModel = useSettings((s) => s.veloxyModel);
	const veloxyBaseUrl = useSettings((s) => s.veloxyBaseUrl);

	const queryClient = useQueryClient();

	const requestInsertRow = useCallback(() => {
		setInsertRowTrigger((n) => n + 1);
	}, []);

	const handleInsertRowSuccess = useCallback(() => {
		void queryClient.invalidateQueries({
			queryKey: queryKeys.tableProperties(connection?.id, selectedTable),
		});
	}, [connection?.id, queryClient, selectedTable]);

	useEffect(() => {
		document.documentElement.classList.toggle("dark", isDark);
	}, [isDark]);

	useEffect(() => {
		const sizes = { sm: 12, md: 14, lg: 16 }
		document.documentElement.style.fontSize = `${sizes[fontSize]}px`
	}, [fontSize])

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

	useEffect(() => {
		if (connectionsQuery.isError && connectionsQuery.error) {
			notifyError(connectionsQuery.error, {
				title: "Failed to load saved connections",
			});
		}
	}, [connectionsQuery.isError, connectionsQuery.error]);

	const connectMutation = useConnectMutation({
		onError: (error) => {
			notifyError(error, { category: "connection", force: true });
		},
		onSuccess: (nextConnection) => {
			notifySuccess(
				`Connected to ${nextConnection.database}`,
				connectionSecondaryText(nextConnection),
			);
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

	const 	activateConnectionMutation = useActivateConnectionMutation({
		onError: (error) => {
			notifyError(error, { category: "connection", force: true });
		},
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

	const deleteConnectionMutation = useDeleteConnectionMutation({
		onError: (error) => {
			notifyError(error, { category: "connection", force: true });
		},
		onSuccess: (connectionId) => {
			queryWorkspaceRef.current?.detachDeletedConnection(connectionId);
			if (connection?.id === connectionId) {
				setConnection(null);
				setSelectedTable(null);
				setTableSearch("");
			}
			notifySuccess("Connection deleted");
		},
	});

	const renameConnectionMutation = useRenameConnectionMutation({
		onError: (error) => {
			notifyError(error, { category: "connection", force: true });
		},
	});

	const connectionRestoreAttemptedRef = useRef(false);
	const autoReconnect = useSettings((s) => s.autoReconnect)

	useEffect(() => {
		if (connectionRestoreAttemptedRef.current) return;
		if (!autoReconnect) { connectionRestoreAttemptedRef.current = true; return }
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
	}, [connectionsQuery.data, connection, activateConnectionMutation, autoReconnect]);

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
	const saveResultEditsMutation = useSaveResultEditsMutation({
		onError: (error) => {
			notifyError(error, {
				category: "query",
				title: "Failed to save edits",
			});
		},
	});
	const deleteRowsMutation = useDeleteRowsMutation({
		onError: (error) => {
			notifyError(error, {
				category: "query",
				title: "Failed to delete rows",
			});
		},
	});
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

	const handleTableQuickAction = useCallback(
		async (
			action: TableQuickSqlAction,
			connectionId: string,
			table: TableInfo,
		) => {
			if (action === "tableProperties") {
				setTablePropertiesTarget({ connectionId, table });
				setTablePropertiesDialogOpen(true);
				return;
			}
			if (action === "addRow") {
				setSelectedTable(table);
				setInsertRowTrigger((n) => n + 1);
				return;
			}

			setSelectedTable(table);
			try {
				switch (action) {
					case "selectAll":
						queryWorkspaceRef.current?.openTabWithSql(
							buildSelectAllSql(table, 200, connection?.engine ?? "postgres"),
						);
						return;
					case "selectCount":
						queryWorkspaceRef.current?.openTabWithSql(
							buildSelectCountSql(table, connection?.engine ?? "postgres"),
						);
						return;
					case "insertTemplate":
					case "updateTemplate":
					case "deleteTemplate": {
						const props = await queryClient.fetchQuery({
							queryKey: queryKeys.tableProperties(connectionId, table),
							queryFn: () =>
								veloxDbRepository.getTableProperties(connectionId, table),
						});

						const pk = props
							.filter((c) => c.isPrimaryKey)
							.map((c) => c.columnName);
						const insertCols = props
							.filter(isInsertFormColumn)
							.map((c) => c.columnName);

						if (action === "insertTemplate") {
							queryWorkspaceRef.current?.openTabWithSql(
								buildInsertTemplateSql(
									table,
									insertCols,
									connection?.engine ?? "postgres",
								),
							);
							return;
						}
						if (action === "updateTemplate") {
							queryWorkspaceRef.current?.openTabWithSql(
								buildUpdateTemplateSql(
									table,
									pk,
									connection?.engine ?? "postgres",
								),
							);
							return;
						}
						queryWorkspaceRef.current?.openTabWithSql(
							buildDeleteTemplateSql(
								table,
								pk,
								connection?.engine ?? "postgres",
							),
						);
						return;
					}
					default:
						return;
				}
			} catch (error) {
				notifyError(error, {
					category: "query",
					title: "Table quick action failed",
					force: true,
				});
			}
		},
		[queryClient, connection?.engine],
	);

	const handleSelectConnection = (nextConnection: ConnectionSummary) => {
		if (connection?.id === nextConnection.id) {
			return;
		}

		activateConnectionMutation.mutate(nextConnection.id);
	};

	const handleRefreshConnection = useCallback(
		(connectionTarget: ConnectionSummary) => {
			void (async () => {
				try {
					await veloxDbRepository.refreshConnection(connectionTarget.id);
				} catch (error) {
					notifyError(error, { category: "connection" });
					return;
				}

				void queryClient.invalidateQueries({ queryKey: queryKeys.connections() });
				void queryClient.invalidateQueries({
					queryKey: queryKeys.databases(connectionTarget.id),
				});
				void queryClient.refetchQueries({
					queryKey: queryKeys.databases(connectionTarget.id),
					type: "active",
				});
				void queryClient.invalidateQueries({
					queryKey: queryKeys.tables(connectionTarget.id),
				});
				void queryClient.refetchQueries({
					queryKey: queryKeys.tables(connectionTarget.id),
					type: "active",
				});
				void queryClient.invalidateQueries({
					queryKey: queryKeys.queryEditorMetadata(connectionTarget.id),
				});
				void queryClient.refetchQueries({
					queryKey: queryKeys.queryEditorMetadata(connectionTarget.id),
					type: "active",
				});
				void queryClient.invalidateQueries({
					queryKey: queryKeys.foreignKeys(connectionTarget.id),
				});
				void queryClient.refetchQueries({
					queryKey: queryKeys.foreignKeys(connectionTarget.id),
					type: "active",
				});

				if (connection?.id === connectionTarget.id) {
					void queryClient.invalidateQueries({
						queryKey: queryKeys.schema(connectionTarget.id, selectedTable),
					});
					void queryClient.refetchQueries({
						queryKey: queryKeys.schema(connectionTarget.id, selectedTable),
						type: "active",
					});
					void queryClient.invalidateQueries({
						queryKey: queryKeys.tableProperties(connectionTarget.id, selectedTable),
					});
					void queryClient.refetchQueries({
						queryKey: queryKeys.tableProperties(connectionTarget.id, selectedTable),
						type: "active",
					});
					queryWorkspaceRef.current?.refreshFocusedResults();
				}
			})();
		},
		[connection?.id, queryClient, selectedTable],
	);

	const handleRefreshTable = useCallback(
		(connectionId: string, table: TableInfo) => {
			void queryClient.invalidateQueries({
				queryKey: queryKeys.tables(connectionId),
			});
			void queryClient.refetchQueries({
				queryKey: queryKeys.tables(connectionId),
				type: "active",
			});
			void queryClient.invalidateQueries({
				queryKey: queryKeys.schema(connectionId, table),
			});
			void queryClient.refetchQueries({
				queryKey: queryKeys.schema(connectionId, table),
				type: "active",
			});
			void queryClient.invalidateQueries({
				queryKey: queryKeys.tableProperties(connectionId, table),
			});
			void queryClient.refetchQueries({
				queryKey: queryKeys.tableProperties(connectionId, table),
				type: "active",
			});
			void queryClient.invalidateQueries({
				queryKey: queryKeys.tableIndexes(connectionId, table),
			});
			void queryClient.refetchQueries({
				queryKey: queryKeys.tableIndexes(connectionId, table),
				type: "active",
			});

			if (
				connection?.id === connectionId &&
				selectedTable?.schema === table.schema &&
				selectedTable?.name === table.name
			) {
				queryWorkspaceRef.current?.refreshFocusedResults();
			}
		},
		[connection?.id, queryClient, selectedTable?.name, selectedTable?.schema],
	);

	const handleRenameTableRequest = useCallback(
		(_connectionId: string, table: TableInfo) => {
			setSelectedTable(table);
			queryWorkspaceRef.current?.appendQuerySql(
				buildRenameTableSql(table, "new_table_name", connection?.engine ?? "postgres"),
			);
		},
		[connection?.engine],
	);

	const handleDeleteTableRequest = useCallback(
		(_connectionId: string, table: TableInfo) => {
			setSelectedTable(table);
			queryWorkspaceRef.current?.appendQuerySql(
				buildDropTableSql(table, connection?.engine ?? "postgres"),
			);
		},
		[connection?.engine],
	);

	const handleRenameConnectionRequest = useCallback(
		(connectionTarget: ConnectionSummary) => {
			setRenamingConnection(connectionTarget);
		},
		[],
	);

	const handleRenameConnectionConfirm = useCallback(
		(connectionTarget: ConnectionSummary, newName: string) => {
			renameConnectionMutation.mutate(
				{ connectionId: connectionTarget.id, newName },
				{
					onSuccess: (updated) => {
						if (connection?.id === updated.id) {
							setConnection(updated);
						}
					},
				},
			);
			setRenamingConnection(null);
		},
		[connection?.id, renameConnectionMutation],
	);

	const handleDisconnectConnectionRequest = useCallback(
		(connectionTarget: ConnectionSummary) => {
			const confirmed = window.confirm(
				`Delete connection "${connectionTarget.name}"?\n\nThis will remove it from saved connections and close any active SSH tunnels.`,
			);
			if (!confirmed) return;

			deleteConnectionMutation.mutate(connectionTarget.id);

			if (connection?.id === connectionTarget.id) {
				setConnection(null);
				setSelectedTable(null);
				setTableSearch("");
				setTablePropertiesDialogOpen(false);
				setTablePropertiesTarget(null);
			}
		},
		[connection?.id, deleteConnectionMutation],
	);

	const handleCopyConnectionString = useCallback(
		(target: ConnectionSummary) => {
			const value =
				target.engine === "sqlite"
					? `sqlite://${target.filePath ?? target.database}`
					: `${target.engine === "mysql" ? "mysql" : "postgresql"}://${target.user}@${target.host}:${target.port}/${target.database}`;
			void navigator.clipboard.writeText(value);
		},
		[],
	);

	const handleTruncateTable = useCallback(
		(_connectionId: string, table: TableInfo) => {
			setSelectedTable(table);
			if ((connection?.engine ?? "postgres") === "mysql") {
				queryWorkspaceRef.current?.appendQuerySql(
					`TRUNCATE TABLE ${quoteIdent(table.schema, "mysql")}.${quoteIdent(table.name, "mysql")};`,
				);
				return;
			}
			if ((connection?.engine ?? "postgres") === "sqlite") {
				queryWorkspaceRef.current?.appendQuerySql(
					`DELETE FROM ${quoteIdent(table.name, "sqlite")};`,
				);
				return;
			}
			queryWorkspaceRef.current?.appendQuerySql(
				`TRUNCATE TABLE ${quoteIdent(table.schema, "postgres")}.${quoteIdent(table.name, "postgres")} RESTART IDENTITY CASCADE;`,
			);
		},
		[connection?.engine],
	);

	const handleCopyTableName = useCallback(
		(_connectionId: string, table: TableInfo) => {
			const engine = connection?.engine ?? "postgres";
			const value =
				engine === "sqlite"
					? quoteIdent(table.name, "sqlite")
					: `${quoteIdent(table.schema, engine)}.${quoteIdent(table.name, engine)}`;
			void navigator.clipboard.writeText(value);
		},
		[connection?.engine],
	);

	const handleRefreshDatabases = useCallback(
		(connectionId: string) => {
			void queryClient.invalidateQueries({
				queryKey: queryKeys.databases(connectionId),
			});
			void queryClient.refetchQueries({
				queryKey: queryKeys.databases(connectionId),
				type: "active",
			});
		},
		[queryClient],
	);

	const handleCopyDatabaseName = useCallback(
		(_connectionId: string, database: string) => {
			void navigator.clipboard.writeText(database);
		},
		[],
	);

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
			engine: connection.engine,
			table: selectedTable,
			patches,
		});

		queryWorkspaceRef.current?.refreshFocusedResults();
	};

	const handleDeleteRows = async (
		primaryKeys: Record<string, string | null>[],
	) => {
		if (!selectedTable || !connection?.id || primaryKeys.length === 0) {
			return;
		}

		await deleteRowsMutation.mutateAsync({
			connectionId: connection.id,
			engine: connection.engine,
			table: selectedTable,
			primaryKeys,
		});

		queryWorkspaceRef.current?.refreshFocusedResults();
	};

	const handleAskVeloxyChatSubmit = async (
		naturalPrompt: string,
		requestId: string,
	): Promise<AskVeloxyChatResponse> => {
			if (!connection?.id) {
				const message = "Select a connection before using Ask Veloxy.";
				setAskVeloxyError(message);
				throw new Error(message);
			}
			if (!veloxyOpenRouterApiKey.trim()) {
				const message = "Add your OpenRouter API key in Settings → Veloxy.";
				setAskVeloxyError(message);
				throw new Error(message);
			}
			if (!veloxyModel.trim()) {
				const message = "Choose a Veloxy model in Settings → Veloxy.";
				setAskVeloxyError(message);
				throw new Error(message);
			}
			setAskVeloxyPending(true);
			setAskVeloxyError(null);
			try {
				return await veloxDbRepository.chatWithDb({
					connectionId: connection.id,
					naturalPrompt,
					requestId,
					targetTable: selectedTable
						? { schema: selectedTable.schema, name: selectedTable.name }
						: undefined,
					providerConfig: {
						apiKey: veloxyOpenRouterApiKey,
						model: veloxyModel,
						baseUrl: veloxyBaseUrl,
					},
					maxRows: useSettings.getState().maxQueryRows,
				});
			} catch (error) {
				const message =
					error instanceof Error
						? error.message
						: "Ask Veloxy chat failed.";
				setAskVeloxyError(message);
				notifyError(error, { category: "query", title: "Ask Veloxy chat failed" });
				throw error instanceof Error ? error : new Error(message);
			} finally {
				setAskVeloxyPending(false);
			}
	};

	const handleCancelVeloxyRequest = async () => {
		try {
			await veloxDbRepository.cancelVeloxyRequest();
		} catch (error) {
			const message =
				error instanceof Error ? error.message : "Failed to stop Veloxy.";
			setAskVeloxyError(message);
		}
	};

	const handleAskVeloxyActionSubmit = async (
		naturalPrompt: string,
	): Promise<AskVeloxySubmitResult> => {
			if (!connection?.id) {
				const message = "Select a connection before using Ask Veloxy.";
				setAskVeloxyError(message);
				throw new Error(message);
			}
			if (!veloxyOpenRouterApiKey.trim()) {
				const message = "Add your OpenRouter API key in Settings → Veloxy.";
				setAskVeloxyError(message);
				throw new Error(message);
			}
			if (!veloxyModel.trim()) {
				const message = "Choose a Veloxy model in Settings → Veloxy.";
				setAskVeloxyError(message);
				throw new Error(message);
			}
			setAskVeloxyPending(true);
			setAskVeloxyError(null);
			try {
				const response = await veloxDbRepository.generateSqlFromNl({
					connectionId: connection.id,
					naturalPrompt,
					targetTable: selectedTable
						? { schema: selectedTable.schema, name: selectedTable.name }
						: undefined,
					providerConfig: {
						apiKey: veloxyOpenRouterApiKey,
						model: veloxyModel,
						baseUrl: veloxyBaseUrl,
					},
					maxRows: useSettings.getState().maxQueryRows,
				});
				const sql = response.sql.trim();
				const lower = sql.toLowerCase();
				const isReadIntent = response.intent === "select";
				const isLikelyLarge =
					sql.length > 1800 ||
					(lower.includes("select") && !lower.includes(" limit ")) ||
					/\bcross\s+join\b|\bpg_sleep\s*\(/i.test(lower);
				const canAutoRun = isReadIntent && !isLikelyLarge;

				if (canAutoRun) {
					queryWorkspaceRef.current?.openTabWithSqlAndRun(sql);
					notifySuccess("Veloxy generated SQL", "Auto-ran safe read query");
					return {
						response,
						decision: "auto-ran",
					};
				}

				queryWorkspaceRef.current?.openTabWithSql(sql);
				return {
					response,
					decision: "needs-confirmation",
					decisionReason: isReadIntent
						? "Read query looks large/risky. Confirm before running."
						: "Non-read query requires confirmation before running.",
					pendingSql: sql,
				};
			} catch (error) {
				const message =
					error instanceof Error
						? error.message
						: "Ask Veloxy failed to generate SQL.";
				setAskVeloxyError(message);
				notifyError(error, { category: "query", title: "Ask Veloxy failed" });
				throw error instanceof Error ? error : new Error(message);
			} finally {
				setAskVeloxyPending(false);
			}
	};

	const handleLoadVeloxyConversation = async (): Promise<AskVeloxyConversationResponse> => {
		if (!connection?.id) return { messages: [] };
		try {
			return await veloxDbRepository.loadVeloxyConversation(connection.id);
		} catch (error) {
			const message =
				error instanceof Error
					? error.message
					: "Failed to load Ask Veloxy conversation.";
			setAskVeloxyError(message);
			return { messages: [] };
		}
	};

	const handleClearVeloxyConversation = async () => {
		if (!connection?.id) return;
		try {
			await veloxDbRepository.clearVeloxyConversation(connection.id);
		} catch (error) {
			const message =
				error instanceof Error
					? error.message
					: "Failed to clear Ask Veloxy conversation.";
			setAskVeloxyError(message);
			throw error;
		}
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
									onDatabaseSwitched={setConnection}
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
									<TabsTrigger
										value="model"
										className="px-2.5 text-xs"
										disabled={Boolean(connection && connection.engine !== "postgres")}
									>
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
                    ? connectionHeadline(connection)
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
								onClick={() => setSettingsOpen(true)}
							>
								<GearIcon />
								Settings
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
						schemaLoading={schemaQuery.isLoading}
						schemaError={schemaQuery.isError ? schemaErrorMessage : null}
						columnCount={schemaQuery.data?.length ?? null}
						primaryKeyColumns={primaryKeyColumns}
						editableColumns={editableColumns}
						saveDisabledReason={saveDisabledReason}
						isResultSingleTableEditable={isResultSingleTableEditable}
						saveResultEditsMutation={saveResultEditsMutation}
            onSaveResultEdits={handleSaveResultEdits}
            onDeleteRows={handleDeleteRows}
            onFocusedTabCapabilitiesChange={setFocusedQueryCaps}
						onActivateConnectionForTab={handleActivateConnectionForTab}
						insertRowTrigger={insertRowTrigger}
						insertConnectionId={connection?.id ?? null}
						insertTable={selectedTable}
						canInsertRow={Boolean(connection?.id && selectedTable)}
						onInsertRowSuccess={handleInsertRowSuccess}
						onOpenAddRow={
							connection?.id && selectedTable
								? requestInsertRow
								: undefined
						}
						askVeloxySidebar={(onClose) => (
							<AskVeloxySidebar
								isPending={askVeloxyPending}
								modelLabel={veloxyModel}
								contextTableLabel={
									selectedTable
										? `${selectedTable.schema}.${selectedTable.name}`
										: null
								}
								isConfigured={Boolean(veloxyOpenRouterApiKey.trim() && veloxyModel.trim())}
								onClose={onClose}
								onOpenSettings={() => {
									setSettingsOpen(true);
								}}
								onChatSubmit={handleAskVeloxyChatSubmit}
								onActionSubmit={handleAskVeloxyActionSubmit}
								onLoadConversation={handleLoadVeloxyConversation}
								onClearConversation={handleClearVeloxyConversation}
								onConfirmRun={async (sql) => {
									queryWorkspaceRef.current?.openTabWithSqlAndRun(sql);
									notifySuccess("Veloxy query executed");
								}}
								onInsertSql={(sql) => {
									queryWorkspaceRef.current?.appendQuerySql(sql);
								}}
								onReplaceSql={(sql) => {
									queryWorkspaceRef.current?.replaceQuerySql(sql);
								}}
								onOpenTabWithSql={(sql) => {
									queryWorkspaceRef.current?.openTabWithSql(sql);
								}}
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
								tablesErrorMessage={
									tablesQuery.isError ? tablesErrorMessage : undefined
								}
								isTablesLoading={tablesQuery.isLoading}
								selectedTable={selectedTable}
							/>
						) : (
							<div className="flex h-full items-center justify-center px-6 text-center text-sm text-muted-foreground">
								Model workspace currently supports PostgreSQL only. Active engine:{' '}
								{engineLabel(connection.engine)}.
							</div>
						)}
					</ErrorBoundary>
				) : (
					<div className="flex flex-1 items-center justify-center px-6 text-center text-sm text-muted-foreground">
						Connect to a database to use the model workspace.
					</div>
				)}
			</main>

			<ConnectionDialog
				open={connectionDialogOpen}
				onOpenChange={setConnectionDialogOpen}
				onSubmit={(values) => {
					connectMutation.mutate(values);
				}}
				isPending={connectMutation.isPending}
			/>

			<RenameConnectionDialog
				key={renamingConnection?.id ?? 'none'}
				connection={renamingConnection}
				onConfirm={handleRenameConnectionConfirm}
				onCancel={() => setRenamingConnection(null)}
			/>

			<TablePropertiesDialog
				open={tablePropertiesDialogOpen}
				onOpenChange={(nextOpen) => {
					setTablePropertiesDialogOpen(nextOpen);
					if (!nextOpen) setTablePropertiesTarget(null);
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
				onRunLastQuery={() => {
					queryWorkspaceRef.current?.runLastQuery();
				}}
				onSelectTable={handleSelectTable}
			/>
			<ShortcutSheet />
			<SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
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
