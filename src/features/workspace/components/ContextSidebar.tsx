import type { ConnectionSummary } from "@/data/types";
import { DashboardContextSidebar } from "@/features/dashboards/components/DashboardContextSidebar";
import type { OpenSqlInEditorOptions } from "@/features/dashboards/components/DashboardWorkspace";
import type { ConnectionsSidebarTreeProps } from "@/features/connections/components/ConnectionsSidebarTree";
import { ModelContextSidebar } from "@/features/workspace/components/ModelContextSidebar";
import { QueryContextSidebar } from "@/features/workspace/components/QueryContextSidebar";
import type { MainWorkspaceId } from "@/features/workspace/types";
import { cn } from "@/lib/utils";

type DashboardSidebarProps = {
	connection: ConnectionSummary | null;
	openDashboardId: string | null;
	onOpenDashboard: (id: string) => void;
	onOpenSqlInEditor: (options: OpenSqlInEditorOptions) => void;
	onChartSavedQuery?: (sql: string, connectionId: string) => void;
	onOpenConnection: () => void;
	onToggleCollapsed: () => void;
	onGenerateWithAi?: () => void;
};

type ContextSidebarProps = {
	mainWorkspace: MainWorkspaceId;
	connectionsSidebarProps: ConnectionsSidebarTreeProps;
	dashboardSidebarProps: DashboardSidebarProps;
};

/** Renders the correct context panel content for the active `mainWorkspace` with persistent state. */
export function ContextSidebar({ mainWorkspace, connectionsSidebarProps, dashboardSidebarProps }: ContextSidebarProps) {
	return (
		<div className="h-full w-full">
			<div className={cn("h-full w-full", mainWorkspace !== "dashboard" && "hidden")}>
				<DashboardContextSidebar {...dashboardSidebarProps} />
			</div>
			<div className={cn("h-full w-full", mainWorkspace !== "model" && "hidden")}>
				<ModelContextSidebar {...connectionsSidebarProps} />
			</div>
			<div className={cn("h-full w-full", mainWorkspace !== "query" && "hidden")}>
				<QueryContextSidebar {...connectionsSidebarProps} />
			</div>
		</div>
	);
}
