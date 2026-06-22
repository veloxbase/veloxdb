import { ErrorBoundary } from "@/components/ErrorBoundary";
import { ModelWorkspace } from "@/features/model/components/ModelWorkspace";
import type { WorkspaceShellProps } from "./types";

function engineLabel(engine: string): string {
	if (engine === "postgres") return "PostgreSQL";
	if (engine === "mysql") return "MySQL";
	return "SQLite";
}

export function ModelWorkspaceAdapter(props: WorkspaceShellProps) {
	const { connection, tablesForUi, tablesErrorMessage, isTablesLoading, selectedTable, isDark } = props;

	if (!connection?.id) {
		return (
			<div className="flex flex-1 items-center justify-center px-6 text-center text-sm text-muted-foreground">
				Connect to a database to use the Model workspace.
			</div>
		);
	}

	if (connection.engine !== "postgres") {
		return (
			<div className="flex h-full items-center justify-center px-6 text-center text-sm text-muted-foreground">
				The Model workspace is only available for PostgreSQL connections ({engineLabel(connection.engine)} selected).
			</div>
		);
	}

	return (
		<ErrorBoundary>
			<ModelWorkspace
				key={connection.id}
				connectionId={connection.id}
				connectionEngine={connection.engine}
				defaultDatabaseName={connection.database}
				isDark={isDark}
				tables={tablesForUi}
				tablesErrorMessage={tablesErrorMessage}
				isTablesLoading={isTablesLoading}
				selectedTable={selectedTable}
			/>
		</ErrorBoundary>
	);
}
