import {
	ConnectionsSidebarTree,
	type ConnectionsSidebarTreeProps,
} from "@/features/connections/components/ConnectionsSidebarTree";

export type QueryContextSidebarProps = ConnectionsSidebarTreeProps;

export function QueryContextSidebar(props: QueryContextSidebarProps) {
	return <ConnectionsSidebarTree {...props} />;
}
