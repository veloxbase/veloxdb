import {
	ArrowUpIcon,
	ChartBarIcon,
	CodeIcon,
	DatabaseIcon,
	PlusIcon,
	SquareIcon,
	TableIcon,
} from "@phosphor-icons/react";
import {
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
	type KeyboardEvent,
	type ReactNode,
	type Ref,
} from "react";

import type { TableInfo } from "@/data/types";
import { cn } from "@/lib/utils";

type PromptBarSource = {
	key: string;
	name: string;
	description: string;
	prompt: string;
	icon: ReactNode;
};

type PromptBarCommand = {
	key: string;
	name: string;
	description: string;
	prompt: string;
};

type MenuRow = {
	key: string;
	name: string;
	description: string;
	prompt: string;
	icon?: ReactNode;
};

type MenuKind = "at" | "slash" | null;

type VeloxyPromptBarProps = {
	value: string;
	onChange: (value: string) => void;
	onSend: () => void;
	onStop: () => void;
	busy?: boolean;
	disabled?: boolean;
	placeholder?: string;
	selectedTable?: TableInfo | null;
	databaseName?: string | null;
	activeWorkspace?: "query" | "dashboard" | "model";
	modelSlot?: ReactNode;
	inputRef?: Ref<HTMLTextAreaElement>;
};

const LINE = 22;
const MAX_ROWS = 5;

const COMMANDS_BY_WORKSPACE: Record<string, PromptBarCommand[]> = {
	query: [
		{
			key: "tour",
			name: "/tour",
			description: "What’s in this database?",
			prompt: "Give me a short tour of this database: important tables, what they store, and how they relate.",
		},
		{
			key: "sample",
			name: "/sample",
			description: "Show a useful first table",
			prompt: "Write a simple SELECT that shows a useful sample of rows from the most important table.",
		},
		{
			key: "indexes",
			name: "/indexes",
			description: "Find slow joins",
			prompt: "Analyze table relations and suggest missing indexes for frequently joined foreign keys.",
		},
		{
			key: "sql",
			name: "/sql",
			description: "Write the query",
			prompt: "Write SQL for this, then explain it in one sentence.",
		},
	],
	dashboard: [
		{
			key: "kpis",
			name: "/kpis",
			description: "Suggest KPI cards",
			prompt: "Suggest 4 essential KPI metric cards and SQL queries for key business metrics.",
		},
		{
			key: "trend",
			name: "/trend",
			description: "Monthly totals",
			prompt: "Draft a grouped time-series query with monthly totals suitable for a line chart.",
		},
		{
			key: "chart",
			name: "/chart",
			description: "Propose a chart",
			prompt: "Propose one chart for the most important metric in this database, with SQL.",
		},
	],
	model: [
		{
			key: "audit",
			name: "/audit",
			description: "Missing keys",
			prompt: "Inspect database tables and list any tables missing primary keys or proper constraints.",
		},
		{
			key: "cycles",
			name: "/cycles",
			description: "Circular FKs",
			prompt: "Analyze schema graph for potential circular dependency cycles or cascading risks.",
		},
		{
			key: "normalize",
			name: "/normalize",
			description: "Schema improvements",
			prompt: "Review table schemas and suggest normalization or column type optimizations.",
		},
	],
};

function parseToken(draft: string): { kind: "at" | "slash"; query: string; start: number } | null {
	const match = /(^|\s)([@/])([\w-]*)$/.exec(draft);
	if (!match) return null;
	return {
		kind: match[2] === "@" ? "at" : "slash",
		query: match[3].toLowerCase(),
		start: match.index + match[1].length,
	};
}

export function VeloxyPromptBar({
	value,
	onChange,
	onSend,
	onStop,
	busy = false,
	disabled = false,
	placeholder = "Message Veloxy…",
	selectedTable,
	databaseName,
	activeWorkspace = "query",
	modelSlot,
	inputRef,
}: VeloxyPromptBarProps) {
	const rootRef = useRef<HTMLDivElement>(null);
	const localInputRef = useRef<HTMLTextAreaElement>(null);
	const glowRef = useRef<HTMLDivElement>(null);
	const rowRefs = useRef<Array<HTMLButtonElement | null>>([]);
	const lastOpen = useRef<MenuKind>(null);
	const [plusOpen, setPlusOpen] = useState(false);
	const [dismissed, setDismissed] = useState(false);
	const [active, setActive] = useState(0);
	const [pressed, setPressed] = useState(false);

	const assignRef = (node: HTMLTextAreaElement | null) => {
		localInputRef.current = node;
		if (typeof inputRef === "function") inputRef(node);
		else if (inputRef) inputRef.current = node;
	};

	const sources = useMemo<PromptBarSource[]>(() => {
		const items: PromptBarSource[] = [
			{
				key: "schema",
				name: databaseName || "This database",
				description: "Ask about the schema",
				prompt: "Give me a short tour of this database: important tables, what they store, and how they relate.",
				icon: <DatabaseIcon className="size-3.5" weight="duotone" />,
			},
		];
		if (selectedTable) {
			const schema = selectedTable.schema ? `${selectedTable.schema}.` : "";
			items.push({
				key: "table",
				name: `${schema}${selectedTable.name}`,
				description: "Preview this table",
				prompt: `Write a simple SELECT that samples useful rows from ${schema}${selectedTable.name}.`,
				icon: <TableIcon className="size-3.5" weight="duotone" />,
			});
		}
		items.push({
			key: "sql",
			name: "Write SQL",
			description: "Draft and explain a query",
			prompt: "Write SQL for this, then explain it in one sentence.",
			icon: <CodeIcon className="size-3.5" weight="duotone" />,
		});
		if (activeWorkspace === "dashboard") {
			items.push({
				key: "chart",
				name: "Chart",
				description: "Propose a chart",
				prompt: "Propose one chart for the most important metric in this database, with SQL.",
				icon: <ChartBarIcon className="size-3.5" weight="duotone" />,
			});
		}
		return items;
	}, [activeWorkspace, databaseName, selectedTable]);

	const commands = COMMANDS_BY_WORKSPACE[activeWorkspace] ?? COMMANDS_BY_WORKSPACE.query;
	const token = dismissed ? null : parseToken(value);
	const open: MenuKind = plusOpen ? "at" : (token?.kind ?? null);
	const query = plusOpen ? "" : (token?.query ?? "");
	const list = useMemo<MenuRow[]>(() => {
		if (open === "at") {
			return sources.filter((source) => source.name.toLowerCase().includes(query));
		}
		if (open === "slash") {
			return commands.filter((command) => command.name.replace(/^\//, "").toLowerCase().startsWith(query));
		}
		return [];
	}, [commands, open, query, sources]);
	const cursor = Math.min(active, Math.max(0, list.length - 1));
	const canSend = value.trim().length > 0;
	const armed = busy || canSend;

	const focusInput = () => localInputRef.current?.focus({ preventScroll: true });
	const closeMenus = useCallback(() => {
		setPlusOpen(false);
	}, []);

	useLayoutEffect(() => {
		const el = localInputRef.current;
		if (!el) return;
		el.style.height = "0px";
		const max = LINE * MAX_ROWS;
		el.style.height = `${Math.min(el.scrollHeight, max)}px`;
		el.style.overflowY = el.scrollHeight > max ? "auto" : "hidden";
	}, [value]);

	useLayoutEffect(() => {
		const glow = glowRef.current;
		if (!glow || !open) return;
		const row = rowRefs.current[cursor];
		if (!row) {
			glow.style.opacity = "0";
			return;
		}
		const fresh = lastOpen.current !== open;
		lastOpen.current = open;
		if (fresh) glow.style.transition = "none";
		glow.style.top = `${row.offsetTop}px`;
		glow.style.height = `${row.offsetHeight}px`;
		glow.style.opacity = "1";
		if (fresh) {
			void glow.offsetHeight;
			glow.style.transition = "";
		}
	}, [cursor, list, open]);

	useEffect(() => {
		if (!plusOpen) return undefined;
		const onDown = (event: PointerEvent) => {
			if (!rootRef.current?.contains(event.target as Node)) closeMenus();
		};
		document.addEventListener("pointerdown", onDown);
		return () => document.removeEventListener("pointerdown", onDown);
	}, [closeMenus, plusOpen]);

	const pick = (index: number) => {
		const row = list[index];
		if (!row) return;
		onChange(row.prompt);
		setPlusOpen(false);
		setDismissed(false);
		focusInput();
	};

	const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
		if (event.key === "Escape" && busy) {
			event.preventDefault();
			onStop();
			return;
		}
		if (open && list.length) {
			if (event.key === "ArrowDown" || event.key === "ArrowUp") {
				event.preventDefault();
				setActive((cursor + (event.key === "ArrowDown" ? 1 : list.length - 1)) % list.length);
				return;
			}
			if ((event.key === "Enter" && !event.shiftKey) || event.key === "Tab") {
				event.preventDefault();
				pick(cursor);
				return;
			}
		}
		if (event.key === "Escape" && open) {
			event.preventDefault();
			setDismissed(true);
			closeMenus();
			return;
		}
		if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
		event.preventDefault();
		if (disabled || busy || !canSend) return;
		closeMenus();
		onSend();
	};

	return (
		<div ref={rootRef} className="relative w-full">
			{open ? (
				<div
					className="absolute inset-x-0 bottom-[calc(100%+6px)] z-20 overflow-hidden rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-md motion-safe:animate-prompt-bar-pop"
					role="listbox"
				>
					<div
						ref={glowRef}
						className="pointer-events-none absolute inset-x-1 rounded-md bg-accent/80 opacity-0 motion-safe:transition-[top,height,opacity] motion-safe:duration-120 motion-safe:ease-[var(--motion-ease)]"
						aria-hidden
					/>
					{list.map((row, i) => (
						<button
							key={row.key}
							ref={(el) => {
								rowRefs.current[i] = el;
							}}
							type="button"
							role="option"
							aria-selected={i === cursor}
							className="relative z-[1] flex h-9 w-full cursor-pointer items-center gap-2.5 rounded-md px-2 text-left text-[12px] outline-none"
							onMouseDown={(event) => event.preventDefault()}
							onPointerEnter={() => setActive(i)}
							onClick={() => pick(i)}
						>
							{row.icon ? (
								<span className="flex size-6 shrink-0 items-center justify-center rounded-md border border-border/70 bg-muted/40 text-muted-foreground">
									{row.icon}
								</span>
							) : null}
							<span className="min-w-0 flex-1 truncate font-medium text-foreground">{row.name}</span>
							<span className="truncate text-[11px] text-muted-foreground">{row.description}</span>
						</button>
					))}
					{list.length === 0 ? (
						<p className="px-2 py-2 text-[11px] text-muted-foreground">No matches for “{query}”</p>
					) : null}
				</div>
			) : null}

			<div className="rounded-lg border border-input bg-background shadow-none focus-within:border-ring focus-within:ring-1 focus-within:ring-ring/40">
				<div className="flex items-start gap-1 px-1.5 pt-1.5">
					<button
						type="button"
						disabled={disabled}
						aria-label="Insert a source"
						className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"
						onMouseDown={(event) => event.preventDefault()}
						onClick={() => {
							setDismissed(false);
							setActive(0);
							setPlusOpen((openPlus) => !openPlus);
							focusInput();
						}}
					>
						<PlusIcon className="size-3.5" />
					</button>
					<textarea
						ref={assignRef}
						value={value}
						disabled={disabled}
						placeholder={placeholder}
						rows={1}
						className="min-h-[28px] flex-1 resize-none bg-transparent py-1.5 pr-1 text-[13px] leading-[22px] text-foreground outline-none placeholder:text-muted-foreground/60 disabled:opacity-50"
						onChange={(event) => {
							onChange(event.target.value);
							setDismissed(false);
							closeMenus();
							setActive(0);
						}}
						onKeyDown={onKeyDown}
					/>
					<button
						type="button"
						aria-label={busy ? "Stop" : "Send"}
						disabled={disabled || (!busy && !canSend)}
						className={cn(
							"mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground disabled:opacity-40",
							armed && "motion-safe:active:scale-[0.96]",
							pressed && armed && "motion-safe:scale-[0.96]",
						)}
						onMouseDown={(event) => event.preventDefault()}
						onPointerDown={(event) => {
							if (event.button !== 0 || !armed) return;
							setPressed(true);
						}}
						onPointerUp={() => setPressed(false)}
						onPointerCancel={() => setPressed(false)}
						onPointerLeave={() => setPressed(false)}
						onClick={() => {
							if (busy) onStop();
							else onSend();
						}}
					>
						{busy ? <SquareIcon className="size-3.5" weight="fill" /> : <ArrowUpIcon className="size-3.5" weight="bold" />}
					</button>
				</div>
				<div className="flex items-center justify-between gap-2 px-2 pb-1.5 pt-1">
					<div className="min-w-0">{modelSlot}</div>
					<p className="hidden text-[10px] text-muted-foreground sm:block">
						<span className="font-medium text-foreground/70">Enter</span>
						<span className="ml-1">to send</span>
					</p>
				</div>
			</div>
		</div>
	);
}
