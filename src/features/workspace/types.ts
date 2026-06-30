import type { ConnectionSummary, TableInfo } from "@/data/types";

export type MainWorkspaceId = "query" | "model";

export interface WorkspaceShellProps {
	connection: ConnectionSummary | null;
	connectionError: unknown;
	connectionErrorMessage: string;
	isDark: boolean;
	onRequestConnection: () => void;
	resultsHeight: number;
	onResultsHeightChange: (height: number) => void;
	selectedTable: TableInfo | null;
	tablesForUi: TableInfo[];
	tablesErrorMessage: string | undefined;
	isTablesLoading: boolean;
}
