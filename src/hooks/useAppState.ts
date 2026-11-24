import { useQueryClient } from "@tanstack/react-query";
import {
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { useTranslation } from "react-i18next";
import { isTauri } from "@tauri-apps/api/core";

import { queryKeys } from "@/data/query-keys";
import { veloxDbRepository } from "@/data/repositories";
import type { ConnectionSummary, TableInfo } from "@/data/types";
import {
	useActivateConnectionMutation,
	useConnectionsQuery,
	useConnectMutation,
	useDeleteConnectionMutation,
	useRenameConnectionMutation,
} from "@/features/connections/queries";
import { useSaveResultEditsMutation, useDeleteRowsMutation } from "@/features/queries/queries";
import { useTableSchemaQuery, useTablePropertiesQuery } from "@/features/schema/queries";
import { useTablesQuery } from "@/features/tables/queries";
import {
	buildDropTableSql,
	buildDeleteTemplateSql,
	buildInsertTemplateSql,
	buildUpdateTemplateSql,
	buildRenameTableSql,
	buildSelectAllSql,
	buildSelectCountSql,
} from "@/features/queries/sql-templates";
import type { TableQuickSqlAction } from "@/features/queries/table-quick-actions";
import type { ResultEditPatch } from "@/features/queries/result-edits";
import { isInsertFormColumn } from "@/features/queries/result-edits";
import { quoteIdent } from "@/lib/sql-ident";
import { notifyError, notifySuccess } from "@/lib/error-notifier";
import { fetchTablesPropertiesSql } from "@/features/schema/format-table-properties-sql";
import { consumeOpenConnectOnLaunch } from "@/features/onboarding/constants";
import { loadAiApiKey } from "@/lib/ai-credentials";
import { useSettings, resolveTheme, themeClassName, THEME_CLASSES, resolveFontSizePx } from "@/lib/settings";

import type { QueryWorkspaceHandle } from "@/features/queries/components/QueryWorkspace";
import type { MainWorkspaceId } from "@/features/workspace/types";
import { loadLastWorkspaceMode } from "@/features/workspace/workspace-ui-persistence";

export const SIDEBAR_WIDTH_KEY = "veloxdb.sidebarWidth";
export const SIDEBAR_COLLAPSED_KEY = "veloxdb.sidebarCollapsed";
export const RESULTS_HEIGHT_KEY = "veloxdb.resultsHeight";
export const LAST_ACTIVE_CONNECTION_KEY = "veloxdb.lastActiveConnectionId";
export const DEFAULT_SIDEBAR_WIDTH = 280;
export const MIN_SIDEBAR_WIDTH = 220;
export const MAX_SIDEBAR_WIDTH = 520;
export const DEFAULT_RESULTS_HEIGHT = 260;

export function clampSidebarWidth(value: number) {
	return Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, value));
}

export function connectionSecondaryText(connection: ConnectionSummary): string {
	if (connection.engine === "mongo") {
		return `mongodb://${connection.host}:${connection.port}/${connection.database}`;
	}
	if (connection.engine === "redis") {
		return `redis://${connection.host}:${connection.port}`;
	}
	if (connection.engine === "duckdb") {
		return connection.filePath === ":memory:" || !connection.filePath
			? "DuckDB in-memory database"
			: `DuckDB file: ${connection.filePath}`;
	}
	if (connection.engine === "sqlite") {
		return connection.filePath === ":memory:"
			? "SQLite in-memory database"
			: `SQLite file: ${connection.filePath ?? connection.database}`;
	}
	return `${connection.user}@${connection.host}:${connection.port}${connection.sshConfig ? " (via SSH)" : ""}`;
}

export function connectionHeadline(connection: ConnectionSummary): string {
	if (connection.engine === "mongo") {
		return `Connected to MongoDB (${connection.host}:${connection.port}/${connection.database})`;
	}
	if (connection.engine === "redis") {
		return `Connected to Redis (${connection.host}:${connection.port})`;
	}
	if (connection.engine === "duckdb") {
		return `Connected to DuckDB (${connection.filePath || "in-memory"})`;
	}
	if (connection.engine === "sqlite") {
		return `Connected to SQLite (${connection.filePath ?? connection.database})`;
	}
	return `Connected to ${connection.database} on ${connection.host}:${connection.port}`;
}

export function engineLabel(engine: ConnectionSummary["engine"]): string {
	if (engine === "postgres") return "PostgreSQL";
	if (engine === "mysql") return "MySQL";
	if (engine === "sqlite") return "SQLite";
	if (engine === "mongo") return "MongoDB";
	if (engine === "duckdb") return "DuckDB";
	if (engine === "redis") return "Redis";
	return "Unknown";
}

export function useAppState(
	queryWorkspaceRef: React.RefObject<QueryWorkspaceHandle | null>,
) {
	const { t } = useTranslation();
	const queryClient = useQueryClient();

	const [connection, setConnection] = useState<ConnectionSummary | null>(null);
	const [focusedQueryCaps, setFocusedQueryCaps] = useState({ hasLastQuery: false, hasResult: false });
	const [tableSearch, setTableSearch] = useState("");
	const [selectedTable, setSelectedTable] = useState<TableInfo | null>(null);
	const [settingsOpen, setSettingsOpen] = useState(false);
	const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
	const [connectionDialogOpen, setConnectionDialogOpen] = useState(() =>
		consumeOpenConnectOnLaunch(),
	);
	const [renamingConnection, setRenamingConnection] = useState<ConnectionSummary | null>(null);
	const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(() =>
		window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "true",
	);
	const [sidebarWidth, setSidebarWidth] = useState(() => {
		const value = Number(window.localStorage.getItem(SIDEBAR_WIDTH_KEY));
		return Number.isFinite(value) ? clampSidebarWidth(value) : DEFAULT_SIDEBAR_WIDTH;
	});
	const [resultsHeight, setResultsHeight] = useState(() => {
		const value = Number(window.localStorage.getItem(RESULTS_HEIGHT_KEY));
		return Number.isFinite(value) && value > 0 ? value : DEFAULT_RESULTS_HEIGHT;
	});
	const [tablePropertiesDialogOpen, setTablePropertiesDialogOpen] = useState(false);
	const [tablePropertiesTarget, setTablePropertiesTarget] = useState<{
		connectionId: string; table: TableInfo;
	} | null>(null);
	const [insertRowTrigger, setInsertRowTrigger] = useState(0);
	const [mainWorkspace, setMainWorkspace] = useState<MainWorkspaceId>(() => loadLastWorkspaceMode() ?? "query");
	const veloxyApiKey = useSettings((s) => s.veloxyApiKey);
	const veloxyModel = useSettings((s) => s.veloxyModel);
	const autoReconnect = useSettings((s) => s.autoReconnect);

  const themeSetting = useSettings((s) => s.theme);
  const isDark = useMemo(() => resolveTheme(themeSetting) === "dark", [themeSetting]);
  const fontSize = useSettings((s) => s.fontSize);
  const borderRadius = useSettings((s) => s.borderRadius);
  const windowOpacity = useSettings((s) => s.windowOpacity);
  const backgroundBlur = useSettings((s) => s.backgroundBlur);

  useEffect(() => {
    const root = document.documentElement;
    // Remove all theme classes, then apply the active one
    root.classList.remove(...THEME_CLASSES);

    // Resolve 'system' to a concrete light/dark before picking the CSS class
    const resolved = themeSetting === 'system'
      ? (resolveTheme(themeSetting) === 'dark' ? 'dark' : 'light')
      : themeSetting;
    const cls = themeClassName(resolved);
    if (cls) root.classList.add(cls);

    // Listen for OS preference changes when in system mode
    if (themeSetting === 'system') {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      const onChange = () => {
        root.classList.remove(...THEME_CLASSES);
        const c = mq.matches ? 'dark' : null;
        if (c) root.classList.add(c);
      };
      mq.addEventListener('change', onChange);
      return () => mq.removeEventListener('change', onChange);
    }
  }, [themeSetting]);

	useEffect(() => {
		const sizePx = resolveFontSizePx(fontSize);
		document.documentElement.style.fontSize = `${sizePx}px`;
	}, [fontSize]);

	const veloxyProvider = useSettings((s) => s.veloxyProvider);
	useEffect(() => {
		// Each provider has its own keychain entry; reload when it changes.
		void loadAiApiKey();
	}, [veloxyProvider]);

	useEffect(() => {
		const radius = Number.isFinite(borderRadius) ? Math.max(0, Math.min(16, borderRadius)) : 0;
		document.documentElement.style.setProperty("--radius", `${radius}px`);
	}, [borderRadius]);

	useEffect(() => {
		const opacity = Number.isFinite(windowOpacity) ? Math.max(40, Math.min(100, windowOpacity)) : 100;
		document.documentElement.style.setProperty("--window-opacity", String(opacity / 100));
	}, [windowOpacity]);

	useEffect(() => {
		if (!isTauri()) return;
		void veloxDbRepository.setWindowBlur(Boolean(backgroundBlur)).catch(() => {});
	}, [backgroundBlur]);

	useEffect(() => {
		window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(isSidebarCollapsed));
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
			notifyError(connectionsQuery.error, { title: t("connection.failedToLoad") });
		}
	}, [connectionsQuery.isError, connectionsQuery.error, t]);

	const connectMutation = useConnectMutation({
		onError: (error) => {
			notifyError(error, { category: "connection", force: true });
		},
		onSuccess: (nextConnection) => {
			notifySuccess(
				t("connection.connected", { database: nextConnection.database }),
				connectionSecondaryText(nextConnection),
			);
			window.localStorage.setItem(LAST_ACTIVE_CONNECTION_KEY, nextConnection.id);
			setConnection(nextConnection);
			setSelectedTable(null);
			setTableSearch("");
			setIsSidebarCollapsed(false);
			setConnectionDialogOpen(false);
			setTablePropertiesDialogOpen(false);
			setTablePropertiesTarget(null);
			queueMicrotask(() => queryWorkspaceRef.current?.setActiveTabConnection(nextConnection.id));
		},
	});

	const activateConnectionMutation = useActivateConnectionMutation({
		onError: (error) => {
			notifyError(error, { category: "connection", force: true });
		},
		onSuccess: (nextConnection) => {
			window.localStorage.setItem(LAST_ACTIVE_CONNECTION_KEY, nextConnection.id);
			setConnection(nextConnection);
			setSelectedTable(null);
			setTableSearch("");
			setTablePropertiesDialogOpen(false);
			setTablePropertiesTarget(null);
			queueMicrotask(() => queryWorkspaceRef.current?.setActiveTabConnection(nextConnection.id));
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
			notifySuccess(t("connection.deleted"));
		},
	});

	const renameConnectionMutation = useRenameConnectionMutation({
		onError: (error) => {
			notifyError(error, { category: "connection", force: true });
		},
	});

	const connectionRestoreAttemptedRef = useRef(false);

	useEffect(() => {
		if (connectionRestoreAttemptedRef.current) return;
		if (!autoReconnect) { connectionRestoreAttemptedRef.current = true; return; }
		const list = connectionsQuery.data;
		if (!list?.length) return;
		if (connection) { connectionRestoreAttemptedRef.current = true; return; }

		const savedId = window.localStorage.getItem(LAST_ACTIVE_CONNECTION_KEY);
		if (!savedId) { connectionRestoreAttemptedRef.current = true; return; }

		const match = list.find((c) => c.id === savedId);
		const target = match ?? list[0];
		if (!target) { connectionRestoreAttemptedRef.current = true; return; }

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
			notifyError(error, { category: "query", title: t("editor.failedToSave") });
		},
	});
	const deleteRowsMutation = useDeleteRowsMutation({
		onError: (error) => {
			notifyError(error, { category: "query", title: t("editor.failedToDelete") });
		},
	});

	const tablesForUi = tablesQuery.data ?? [];
	const activeConnectionEngine = connection?.engine ?? "postgres";

	const requestInsertRow = useCallback(() => setInsertRowTrigger((n) => n + 1), []);

	const handleInsertRowSuccess = useCallback(() => {
		void queryClient.invalidateQueries({ queryKey: queryKeys.tableProperties(connection?.id, selectedTable) });
	}, [connection?.id, queryClient, selectedTable]);

	const handleSelectTable = (table: TableInfo) => {
		setSelectedTable(table);
		queryWorkspaceRef.current?.replaceQuerySql(table.previewQuery);
	};

	const handlePreviewTable = (table: TableInfo) => {
		setSelectedTable(table);
		queryWorkspaceRef.current?.applyTablePreview(table.previewQuery);
	};

	const handleTableQuickAction = useCallback(async (
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
					queryWorkspaceRef.current?.openTabWithSql(buildSelectAllSql(table, 200, activeConnectionEngine));
					return;
				case "selectCount":
					queryWorkspaceRef.current?.openTabWithSql(buildSelectCountSql(table, activeConnectionEngine));
					return;
				case "insertTemplate":
				case "updateTemplate":
				case "deleteTemplate": {
					const props = await queryClient.fetchQuery({
						queryKey: queryKeys.tableProperties(connectionId, table),
						queryFn: () => veloxDbRepository.getTableProperties(connectionId, table),
					});
					const pk = props.filter((c) => c.isPrimaryKey).map((c) => c.columnName);
					const insertCols = props.filter(isInsertFormColumn).map((c) => c.columnName);
					if (action === "insertTemplate") {
						queryWorkspaceRef.current?.openTabWithSql(buildInsertTemplateSql(table, insertCols, activeConnectionEngine));
					} else if (action === "updateTemplate") {
						queryWorkspaceRef.current?.openTabWithSql(buildUpdateTemplateSql(table, pk, activeConnectionEngine));
					} else {
						queryWorkspaceRef.current?.openTabWithSql(buildDeleteTemplateSql(table, pk, activeConnectionEngine));
					}
					return;
				}
				default:
					return;
			}
		} catch (error) {
			notifyError(error, { category: "query", title: "Table quick action failed", force: true });
		}
	}, [queryClient, activeConnectionEngine, queryWorkspaceRef]);

	const handleSelectConnection = (nextConnection: ConnectionSummary) => {
		if (connection?.id === nextConnection.id) return;
		activateConnectionMutation.mutate(nextConnection.id);
	};

	const handleRefreshConnection = useCallback((connectionTarget: ConnectionSummary) => {
		void (async () => {
			try { await veloxDbRepository.refreshConnection(connectionTarget.id); }
			catch (error) { notifyError(error, { category: "connection" }); return; }
			void queryClient.invalidateQueries({ queryKey: queryKeys.connections() });
			void queryClient.invalidateQueries({ queryKey: queryKeys.databases(connectionTarget.id) });
			void queryClient.refetchQueries({ queryKey: queryKeys.databases(connectionTarget.id), type: "active" });
			void queryClient.invalidateQueries({ queryKey: queryKeys.tables(connectionTarget.id) });
			void queryClient.refetchQueries({ queryKey: queryKeys.tables(connectionTarget.id), type: "active" });
			void queryClient.invalidateQueries({ queryKey: queryKeys.queryEditorMetadata(connectionTarget.id) });
			void queryClient.refetchQueries({ queryKey: queryKeys.queryEditorMetadata(connectionTarget.id), type: "active" });
			void queryClient.invalidateQueries({ queryKey: queryKeys.foreignKeys(connectionTarget.id) });
			void queryClient.refetchQueries({ queryKey: queryKeys.foreignKeys(connectionTarget.id), type: "active" });
			if (connection?.id === connectionTarget.id) {
				void queryClient.invalidateQueries({ queryKey: queryKeys.schema(connectionTarget.id, selectedTable) });
				void queryClient.refetchQueries({ queryKey: queryKeys.schema(connectionTarget.id, selectedTable), type: "active" });
				void queryClient.invalidateQueries({ queryKey: queryKeys.tableProperties(connectionTarget.id, selectedTable) });
				void queryClient.refetchQueries({ queryKey: queryKeys.tableProperties(connectionTarget.id, selectedTable), type: "active" });
				queryWorkspaceRef.current?.refreshFocusedResults();
			}
		})();
	}, [connection?.id, queryClient, selectedTable, queryWorkspaceRef]);

	const handleRefreshTable = useCallback((connectionId: string, table: TableInfo) => {
		void queryClient.invalidateQueries({ queryKey: queryKeys.tables(connectionId) });
		void queryClient.refetchQueries({ queryKey: queryKeys.tables(connectionId), type: "active" });
		void queryClient.invalidateQueries({ queryKey: queryKeys.schema(connectionId, table) });
		void queryClient.refetchQueries({ queryKey: queryKeys.schema(connectionId, table), type: "active" });
		void queryClient.invalidateQueries({ queryKey: queryKeys.tableProperties(connectionId, table) });
		void queryClient.refetchQueries({ queryKey: queryKeys.tableProperties(connectionId, table), type: "active" });
		void queryClient.invalidateQueries({ queryKey: queryKeys.tableIndexes(connectionId, table) });
		void queryClient.refetchQueries({ queryKey: queryKeys.tableIndexes(connectionId, table), type: "active" });
		if (connection?.id === connectionId && selectedTable?.schema === table.schema && selectedTable?.name === table.name) {
			queryWorkspaceRef.current?.refreshFocusedResults();
		}
	}, [connection?.id, queryClient, selectedTable?.name, selectedTable?.schema, queryWorkspaceRef]);

	const handleRenameTableRequest = useCallback((_connectionId: string, table: TableInfo) => {
		setSelectedTable(table);
		queryWorkspaceRef.current?.appendQuerySql(
			buildRenameTableSql(table, "new_table_name", connection?.engine ?? "postgres"),
		);
	}, [connection?.engine, queryWorkspaceRef]);

	const handleDeleteTableRequest = useCallback((_connectionId: string, table: TableInfo) => {
		setSelectedTable(table);
		queryWorkspaceRef.current?.appendQuerySql(
			buildDropTableSql(table, connection?.engine ?? "postgres"),
		);
	}, [connection?.engine, queryWorkspaceRef]);

	const handleRenameConnectionRequest = useCallback((connectionTarget: ConnectionSummary) => {
		setRenamingConnection(connectionTarget);
	}, []);

	const handleRenameConnectionConfirm = useCallback((connectionTarget: ConnectionSummary, newName: string) => {
		renameConnectionMutation.mutate({ connectionId: connectionTarget.id, newName }, {
			onSuccess: (updated) => { if (connection?.id === updated.id) setConnection(updated); },
		});
		setRenamingConnection(null);
	}, [connection?.id, renameConnectionMutation]);

	const handleDisconnectConnectionRequest = useCallback((connectionTarget: ConnectionSummary) => {
		const confirmed = window.confirm(t("connection.deleteConfirm", { name: connectionTarget.name }));
		if (!confirmed) return;
		deleteConnectionMutation.mutate(connectionTarget.id);
		if (connection?.id === connectionTarget.id) {
			setConnection(null);
			setSelectedTable(null);
			setTableSearch("");
			setTablePropertiesDialogOpen(false);
			setTablePropertiesTarget(null);
		}
	}, [connection?.id, deleteConnectionMutation, t]);

	const handleCopyConnectionString = useCallback((target: ConnectionSummary) => {
		const value = target.engine === "sqlite"
			? `sqlite://${target.filePath ?? target.database}`
			: `${target.engine === "mysql" ? "mysql" : "postgresql"}://${target.user}@${target.host}:${target.port}/${target.database}`;
		void navigator.clipboard.writeText(value);
	}, []);

	const handleTruncateTable = useCallback((_connectionId: string, table: TableInfo) => {
		setSelectedTable(table);
		if ((connection?.engine ?? "postgres") === "mysql") {
			queryWorkspaceRef.current?.appendQuerySql(`TRUNCATE TABLE ${quoteIdent(table.schema, "mysql")}.${quoteIdent(table.name, "mysql")};`);
		} else if ((connection?.engine ?? "postgres") === "sqlite") {
			queryWorkspaceRef.current?.appendQuerySql(`DELETE FROM ${quoteIdent(table.name, "sqlite")};`);
		} else {
			queryWorkspaceRef.current?.appendQuerySql(`TRUNCATE TABLE ${quoteIdent(table.schema, "postgres")}.${quoteIdent(table.name, "postgres")} RESTART IDENTITY CASCADE;`);
		}
	}, [connection?.engine, queryWorkspaceRef]);

	const handleCopyTableName = useCallback((_connectionId: string, table: TableInfo) => {
		const engine = connection?.engine ?? "postgres";
		const value = engine === "sqlite"
			? quoteIdent(table.name, "sqlite")
			: `${quoteIdent(table.schema, engine)}.${quoteIdent(table.name, engine)}`;
		void navigator.clipboard.writeText(value);
	}, [connection?.engine]);

	const handleCopyTableSql = useCallback(async (connectionId: string, table: TableInfo) => {
		try {
			const sql = await fetchTablesPropertiesSql(queryClient, connectionId, [table]);
			if (!sql.trim()) {
				notifyError(new Error(t("table.noColumnsFound")), {
					title: t("editor.copyFailed"),
					category: "internal",
				});
				return;
			}
			await navigator.clipboard.writeText(sql);
			notifySuccess(t("editor.copied"));
		} catch (error) {
			notifyError(error, { title: t("editor.copyFailed"), category: "internal" });
		}
	}, [queryClient, t]);

	const handleRefreshDatabases = useCallback((connectionId: string) => {
		void queryClient.invalidateQueries({ queryKey: queryKeys.databases(connectionId) });
		void queryClient.refetchQueries({ queryKey: queryKeys.databases(connectionId), type: "active" });
	}, [queryClient]);

	const handleCopyDatabaseName = useCallback((_connectionId: string, database: string) => {
		void navigator.clipboard.writeText(database);
	}, []);

	const handleActivateConnectionForTab = useCallback((connectionId: string) => {
		if (connection?.id === connectionId) return;
		activateConnectionMutation.mutate(connectionId);
	}, [connection?.id, activateConnectionMutation]);

	const handleSaveResultEdits = async (patches: ResultEditPatch[]) => {
		if (!selectedTable || !connection?.id || patches.length === 0) return;
		await saveResultEditsMutation.mutateAsync({
			connectionId: connection.id,
			engine: connection.engine,
			table: selectedTable,
			patches,
		});
		queryWorkspaceRef.current?.refreshFocusedResults();
	};

	const handleDeleteRows = async (primaryKeys: Record<string, string | null>[]) => {
		if (!selectedTable || !connection?.id || primaryKeys.length === 0) return;
		await deleteRowsMutation.mutateAsync({
			connectionId: connection.id,
			engine: connection.engine,
			table: selectedTable,
			primaryKeys,
		});
		queryWorkspaceRef.current?.refreshFocusedResults();
	};

	const connectionError = connectMutation.error ?? activateConnectionMutation.error;
	const connectionErrorMessage = connectionError instanceof Error ? connectionError.message : t("connection.failedToConnect");
	const connectionsErrorMessage = connectionsQuery.error instanceof Error ? connectionsQuery.error.message : t("connection.failedToLoad");
	const tablesErrorMessage = tablesQuery.error instanceof Error ? tablesQuery.error.message : t("table.failedToLoad");
	const schemaErrorMessage = schemaQuery.error instanceof Error ? schemaQuery.error.message : t("table.failedToLoadSchema");
	const tablePropertiesErrorMessage = tablePropertiesQuery.error instanceof Error ? tablePropertiesQuery.error.message : t("table.failedToLoadProperties");

	const primaryKeyColumns = tablePropertiesQuery.data?.filter((column) => column.isPrimaryKey).map((column) => column.columnName) ?? [];
	const editableColumns = tablePropertiesQuery.data?.filter((column) => !column.isPrimaryKey).map((column) => column.columnName) ?? [];
	const hasSelectedTable = Boolean(selectedTable);
	const hasQueryResult = focusedQueryCaps.hasResult;
	const hasPrimaryKey = primaryKeyColumns.length > 0;
	const isResultSingleTableEditable = hasSelectedTable && hasQueryResult && hasPrimaryKey && !tablePropertiesQuery.isError;
	const saveDisabledReason = !hasSelectedTable ? t("editor.selectTable")
		: !hasQueryResult ? t("editor.runQuery")
		: tablePropertiesQuery.isLoading ? t("editor.loadingMetadata")
		: tablePropertiesQuery.isError ? tablePropertiesErrorMessage
		: !hasPrimaryKey ? t("editor.requiresPrimaryKey")
		: undefined;

	return {
		// State
		connection, setConnection,
		focusedQueryCaps, setFocusedQueryCaps,
		tableSearch, setTableSearch,
		selectedTable,
		settingsOpen, setSettingsOpen,
		commandPaletteOpen, setCommandPaletteOpen,
		connectionDialogOpen, setConnectionDialogOpen,
		renamingConnection, setRenamingConnection,
		isSidebarCollapsed, setIsSidebarCollapsed,
		sidebarWidth, setSidebarWidth,
		resultsHeight, setResultsHeight,
		tablePropertiesDialogOpen, setTablePropertiesDialogOpen,
		tablePropertiesTarget, setTablePropertiesTarget,
		insertRowTrigger,
		mainWorkspace, setMainWorkspace,
		// Derived
		isDark,
		veloxyApiKey, veloxyModel,
		// Queries
		connectionsQuery, tablesQuery, schemaQuery, tablePropertiesQuery,
		saveResultEditsMutation, deleteRowsMutation,
		connectMutation, activateConnectionMutation,
		deleteConnectionMutation, renameConnectionMutation,
		// Computed
		tablesForUi, activeConnectionEngine,
		connectionError, connectionErrorMessage,
		connectionsErrorMessage, tablesErrorMessage,
		schemaErrorMessage, tablePropertiesErrorMessage,
		primaryKeyColumns, editableColumns,
		isResultSingleTableEditable, saveDisabledReason,
		// Handlers
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
	};
}
