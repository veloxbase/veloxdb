import {
	ConnectionsSidebarTree,
	type ConnectionsSidebarTreeProps,
} from "@/features/connections/components/ConnectionsSidebarTree";

export type ModelContextSidebarProps = ConnectionsSidebarTreeProps;

/** Reuses the connections tree for now; Model mode may get a tables-focused variant later. */
export function ModelContextSidebar(props: ModelContextSidebarProps) {
	return <ConnectionsSidebarTree {...props} />;
}
