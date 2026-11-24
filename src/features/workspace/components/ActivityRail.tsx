import { ChartBarIcon, FlowArrowIcon, TerminalIcon } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import type { MainWorkspaceId } from "@/features/workspace/types";
import { cn } from "@/lib/utils";

type ActivityRailProps = {
	mainWorkspace: MainWorkspaceId;
	onChange: (workspace: MainWorkspaceId) => void;
	showModel: boolean;
	showDashboard: boolean;
};

type RailItem = {
	id: MainWorkspaceId;
	icon: ReactNode;
	label: string;
};

export function ActivityRail({ mainWorkspace, onChange, showModel, showDashboard }: ActivityRailProps) {
	const { t } = useTranslation();

	const items: RailItem[] = [
		{ id: "query", icon: <TerminalIcon className="size-4" />, label: t("workspace.query") },
		...(showModel
			? [{ id: "model" as const, icon: <FlowArrowIcon className="size-4" />, label: t("workspace.model") }]
			: []),
		...(showDashboard
			? [{ id: "dashboard" as const, icon: <ChartBarIcon className="size-4" />, label: t("workspace.dashboard") }]
			: []),
	];
	const activeWorkspaceInRail = items.some((item) => item.id === mainWorkspace);

	return (
		<nav className="flex w-12 shrink-0 flex-col items-center gap-1 border-r border-border bg-muted/10 py-3">
			{items.map((item) => (
				<Button
					key={item.id}
					type="button"
					variant="ghost"
					size="icon-lg"
					aria-pressed={activeWorkspaceInRail && mainWorkspace === item.id}
					aria-label={item.label}
					title={item.label}
					className={cn(
						"text-muted-foreground transition-colors duration-[80ms] ease-[var(--motion-ease)] motion-reduce:transition-none",
						activeWorkspaceInRail && mainWorkspace === item.id && "bg-accent text-foreground",
					)}
					onClick={() => onChange(item.id)}
				>
					{item.icon}
				</Button>
			))}
		</nav>
	);
}
