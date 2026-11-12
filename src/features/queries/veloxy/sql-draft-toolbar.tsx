import {
	CaretDownIcon,
} from "@phosphor-icons/react";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export type SqlDraftToolbarProps = {
	sql: string;
	disabled?: boolean;
	onCopy: (sql: string) => void;
	onInsert: (sql: string) => void;
	onReplace: (sql: string) => void;
	onNewTab: (sql: string) => void;
	onRun?: (sql: string) => void;
};

export function SqlDraftToolbar({
	sql,
	disabled,
	onCopy,
	onInsert,
	onReplace,
	onNewTab,
	onRun,
}: SqlDraftToolbarProps) {
	return (
		<div className="mt-1.5 flex flex-wrap items-center gap-1">
			<Button
				type="button"
				variant="default"
				size="sm"
				className="h-6 px-2 text-[10px]"
				disabled={disabled}
				onClick={() => onReplace(sql)}
			>
				Use this SQL
			</Button>
			<Popover>
				<PopoverTrigger asChild>
					<Button
						type="button"
						variant="ghost"
						size="sm"
						className="h-6 px-1.5 text-[10px] text-muted-foreground hover:text-foreground"
						disabled={disabled}
					>
						<CaretDownIcon className="size-3" aria-hidden />
					</Button>
				</PopoverTrigger>
				<PopoverContent align="start" className="w-40 p-1">
					<button type="button" className="flex w-full rounded-md px-2 py-1.5 text-left text-xs hover:bg-accent" disabled={disabled} onClick={() => onInsert(sql)}>
						Insert
					</button>
					<button type="button" className="flex w-full rounded-md px-2 py-1.5 text-left text-xs hover:bg-accent" disabled={disabled} onClick={() => onNewTab(sql)}>
						New tab
					</button>
					<button type="button" className="flex w-full rounded-md px-2 py-1.5 text-left text-xs hover:bg-accent" disabled={disabled} onClick={() => onCopy(sql)}>
						Copy
					</button>
					{onRun ? (
						<button type="button" className="flex w-full rounded-md px-2 py-1.5 text-left text-xs hover:bg-accent" disabled={disabled} onClick={() => onRun(sql)}>
							Run
						</button>
					) : null}
				</PopoverContent>
			</Popover>
		</div>
	);
}
