import { ClockCounterClockwiseIcon, TrashIcon } from "@phosphor-icons/react";
import { useState } from "react";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { VeloxyThreadSummary } from "@/data/types";
import { cn } from "@/lib/utils";

type VeloxyHistoryPopoverProps = {
	threads: VeloxyThreadSummary[];
	activeThreadId: string;
	disabled?: boolean;
	onSelectThread: (id: string) => void;
	onDeleteThread: (id: string) => void;
};

function relativeTime(epochMs: number): string {
	const delta = Date.now() - epochMs;
	const minutes = Math.floor(delta / 60_000);
	if (minutes < 1) return "just now";
	if (minutes < 60) return `${minutes}m ago`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours}h ago`;
	const days = Math.floor(hours / 24);
	if (days < 7) return `${days}d ago`;
	return new Date(epochMs).toLocaleDateString();
}

export function VeloxyHistoryPopover({
	threads,
	activeThreadId,
	disabled,
	onSelectThread,
	onDeleteThread,
}: VeloxyHistoryPopoverProps) {
	const [open, setOpen] = useState(false);

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<button
					type="button"
					disabled={disabled}
					className="flex size-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground disabled:opacity-40"
					title="Chats"
					aria-label="Chats"
				>
					<ClockCounterClockwiseIcon className="size-3.5" />
				</button>
			</PopoverTrigger>
			<PopoverContent align="end" className="w-64 p-1.5 shadow-xl">
				<div className="mb-1.5 border-b border-border/60 px-2 py-1">
					<div className="flex items-center justify-between text-[11px] font-semibold text-foreground">
						<span className="flex items-center gap-1.5">
							<ClockCounterClockwiseIcon className="size-3.5 text-muted-foreground" />
							<span>Chats</span>
						</span>
						<span className="text-[10px] font-normal text-muted-foreground">
							{threads.length} {threads.length === 1 ? "chat" : "chats"}
						</span>
					</div>
				</div>
				<div className="max-h-60 space-y-0.5 overflow-y-auto">
					{threads.length > 0 ? (
						threads.map((thread) => {
							const selected = thread.id === activeThreadId;
							return (
								<div
									key={thread.id}
									className={cn(
										"group flex items-center gap-1 rounded px-1",
										selected ? "bg-accent" : "hover:bg-muted/60",
									)}
								>
									<button
										type="button"
										onClick={() => {
											onSelectThread(thread.id);
											setOpen(false);
										}}
										className={cn(
											"min-w-0 flex-1 px-1 py-1.5 text-left",
											selected ? "text-foreground" : "text-muted-foreground",
										)}
									>
										<p className="truncate text-[11px] font-medium text-foreground">
											{thread.title.trim() || "Untitled chat"}
										</p>
										<p className="truncate text-[10px] text-muted-foreground">
											{relativeTime(thread.openedAt)}
										</p>
									</button>
									<button
										type="button"
										className="size-6 shrink-0 rounded text-muted-foreground opacity-0 transition-opacity hover:bg-background hover:text-foreground group-hover:opacity-100"
										aria-label="Delete chat"
										onClick={(event) => {
											event.stopPropagation();
											onDeleteThread(thread.id);
										}}
									>
										<TrashIcon className="mx-auto size-3" />
									</button>
								</div>
							);
						})
					) : (
						<p className="p-2 text-center text-[11px] text-muted-foreground">
							No saved chats yet
						</p>
					)}
				</div>
			</PopoverContent>
		</Popover>
	);
}
