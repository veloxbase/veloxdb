import {
	ArrowsClockwiseIcon,
	CheckIcon,
	CopyIcon,
	DatabaseIcon,
	RobotIcon,
	WarningCircleIcon,
	XIcon,
} from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { MessagePart, ToolCallPart, UIMessage } from "@tanstack/ai-client";

import { Button } from "@/components/ui/button";
import { LatticeLoader } from "@/components/ui/lattice-loader";
import type { ConnectionSummary, DatabaseEngine, TableInfo } from "@/data/types";
import {
	type ChartEncodings,
	vizConfigToEncodings,
} from "@/features/dashboards/chart-builder-state";
import {
	VeloxyMarkdown,
	type VeloxySqlActions,
} from "@/features/queries/components/VeloxyMarkdown";
import { VeloxyAutoChart } from "@/features/queries/components/VeloxyAutoChart";
import { VeloxyProposedChart } from "@/features/queries/components/VeloxyProposedChart";
import { VeloxyConnectionSelector } from "@/features/queries/components/VeloxyConnectionSelector";
import { VeloxyHistoryPopover } from "@/features/queries/components/VeloxyHistoryPopover";
import { VeloxyModelSelector } from "@/features/queries/components/VeloxyModelSelector";
import { VeloxyPromptBar } from "@/features/queries/components/VeloxyPromptBar";
import { VeloxyStarterPrompts } from "@/features/queries/components/VeloxyStarterPrompts";
import {
	VeloxyChartWorking,
	VeloxyQueryCard,
	VeloxyQuietToolNote,
	VeloxySchemaToolGroup,
} from "@/features/queries/components/VeloxyStepCards";
import { useToolStallClock } from "@/features/queries/veloxy/use-tool-stall-clock";
import {
	hasChartIntent,
	parseProposeChartOutput,
	type ProposeChartResult,
} from "@/features/queries/veloxy/propose-chart";
import { latestSqlFromParts } from "@/features/queries/veloxy/sql-preview";
import {
	activityLine,
	isSchemaTool,
	toolStatusLabel,
} from "@/features/queries/veloxy/tool-status";
import { usePacedScroll } from "@/features/queries/veloxy/use-paced-scroll";
import { useVeloxyChat } from "@/features/queries/veloxy/use-veloxy-chat";
import {
	useDeleteVeloxyThreadMutation,
	useTouchVeloxyThreadMutation,
	useVeloxyThreadsQuery,
} from "@/features/queries/veloxy/queries";
import { notifySuccess } from "@/lib/error-notifier";
import { useSettings } from "@/lib/settings";
import { cn } from "@/lib/utils";

export type VeloxyFixErrorContext = {
	sql: string;
	errorMessage: string;
};

/** Dashboard tile scope for "Ask about this chart"; SQL already has active filters substituted. */
export type VeloxyChartContext = {
	title: string;
	sql: string;
	columns: string[];
	sampleRows: Array<Record<string, string | null>>;
	rowCount: number;
	activeFilters: Record<string, string>;
	/** Unique per click so the same tile can be asked about twice. */
	requestId: string;
};

export function buildChartContextPrompt(context: VeloxyChartContext): string {
	const filters = Object.entries(context.activeFilters);
	const sample = context.sampleRows.slice(0, 8);
	const header = context.columns.join(" | ");
	const rows = sample.map((row) => context.columns.map((column) => row[column] ?? "NULL").join(" | "));
	return [
		`I'm looking at the dashboard tile "${context.title}". Explain what this chart shows, call out the most notable pattern or anomaly, and suggest one follow-up query that would help explain it. Keep the same filters when you write SQL.`,
		"",
		"Tile SQL:",
		"```sql",
		context.sql.trim(),
		"```",
		"",
		filters.length > 0
			? `Active filters: ${filters.map(([name, value]) => `${name} = ${value === "" ? "(all)" : value}`).join(", ")}`
			: "Active filters: none",
		`Result: ${context.rowCount.toLocaleString()} rows, columns: ${context.columns.join(", ") || "(none)"}`,
		...(sample.length > 0 ? ["", "Sample rows:", header, ...rows] : []),
	].join("\n");
}

type AskVeloxySidebarProps = {
	connectionId: string | null;
	engine: DatabaseEngine | null;
	databaseName?: string | null;
	selectedTable?: TableInfo | null;
	connections?: ConnectionSummary[];
	modelLabel: string;
	apiKey: string;
	isConfigured: boolean;
	activeWorkspace?: "query" | "dashboard" | "model";
	fixErrorContext?: VeloxyFixErrorContext | null;
	onClearFixErrorContext?: () => void;
	chartContext?: VeloxyChartContext | null;
	onClearChartContext?: () => void;
	onSelectConnection?: (id: string) => void;
	onNewConnection?: () => void;
	onClose: () => void;
	onOpenSettings: () => void;
	onConfirmRun: (sql: string) => Promise<void>;
	onInsertSql: (sql: string) => void;
	onReplaceSql: (sql: string) => void;
	onOpenTabWithSql: (sql: string) => void;
	onPinToDashboard?: (options: {
		sql: string;
		title?: string;
		defaultChartType?: ProposeChartResult["viz"]["chartType"];
		defaultEncodings?: ChartEncodings;
	}) => void;
}

function pinOptionsFromProposal(proposal: ProposeChartResult) {
	return {
		sql: proposal.sql,
		title: proposal.title,
		defaultChartType: proposal.viz.chartType,
		defaultEncodings: vizConfigToEncodings(proposal.viz),
	};
}

function partText(parts: Array<MessagePart>): string {
	return parts
		.filter((part): part is Extract<MessagePart, { type: "text" }> => part.type === "text")
		.map((part) => part.content)
		.join("");
}

/** Single live status line under the last assistant message. */
function VeloxyActivityLine({ parts }: { parts: Array<MessagePart> }) {
	const toolParts = parts.filter((part): part is ToolCallPart => part.type === "tool-call");
	useToolStallClock(toolParts);
	const line = activityLine(parts, true);
	if (!line) return null;
	return (
		<div className="mt-2 text-muted-foreground">
			<LatticeLoader
				label={line}
				status="working"
				pattern="orbit"
				shape="round"
				cellSize={4}
				gap={1.5}
				fontSize={11}
				showTimer={false}
			/>
		</div>
	);
}

function AssistantParts({
	parts,
	streaming,
	sqlActions,
	sqlActionsDisabled,
	connectionId,
	onRunSql,
	onPinToDashboard,
}: {
	parts: Array<MessagePart>;
	streaming: boolean;
	sqlActions: VeloxySqlActions;
	sqlActionsDisabled: boolean;
	connectionId: string | null;
	onRunSql?: (sql: string) => void;
	onPinToDashboard?: AskVeloxySidebarProps["onPinToDashboard"];
}) {
	const textParts = parts.filter((part) => part.type === "text");
	const lastText = textParts.at(-1);
	// Schema lookups are agent internals — once the answer text exists, only
	// keep the chip when a lookup failed or stalled.
	const answerStarted = textParts.some((part) => part.content.trim().length > 0);
	const nodes: Array<{ key: string; node: ReactNode }> = [];
	let schemaBatch: ToolCallPart[] = [];

	const flushSchemaBatch = () => {
		if (schemaBatch.length === 0) return;
		const batch = schemaBatch;
		schemaBatch = [];
		if (answerStarted && batch.every((part) => toolStatusLabel(part) === "success")) return;
		nodes.push({
			key: `schema:${batch.map((part) => part.id).join(",")}`,
			node: <VeloxySchemaToolGroup parts={batch} />,
		});
	};

	for (const part of parts) {
		if (part.type === "tool-call" && isSchemaTool(part.name)) {
			schemaBatch.push(part);
			continue;
		}
		flushSchemaBatch();
		if (part.type === "text") {
			const key = `text:${part.content.length}:${part.content.slice(0, 48)}`;
			if (!part.content.trim() && streaming && part === lastText) {
				nodes.push({
					key,
					node: (
						<p className="text-[11px] text-muted-foreground">…</p>
					),
				});
				continue;
			}
			if (!part.content) continue;
			nodes.push({
				key,
				node: (
					<VeloxyMarkdown
						content={part.content}
						streaming={streaming && part === lastText}
						sqlActions={sqlActions}
						sqlActionsDisabled={sqlActionsDisabled}
						className="wrap-break-word text-[12px] leading-relaxed text-foreground"
					/>
				),
			});
			continue;
		}
		if (part.type === "tool-call") {
			if (part.name === "propose_chart") {
				const proposal = parseProposeChartOutput(part.output);
				nodes.push({
					key: part.id,
					node: proposal ? (
						<VeloxyProposedChart
							proposal={proposal}
							connectionId={connectionId}
							disabled={sqlActionsDisabled}
							onCopySql={sqlActions.onCopy}
							onInsertSql={sqlActions.onInsert}
							onPinToDashboard={(next) => onPinToDashboard?.(pinOptionsFromProposal(next))}
						/>
					) : (
						<VeloxyChartWorking part={part} />
					),
				});
				continue;
			}
			if (part.name === "run_readonly") {
				nodes.push({
					key: part.id,
					node: (
						<VeloxyQueryCard
							part={part}
							sqlActions={sqlActions}
							sqlActionsDisabled={sqlActionsDisabled}
							onRunSql={onRunSql}
						/>
					),
				});
				continue;
			}
			// Lint, explain, and any future internals: silent unless they fail.
			nodes.push({
				key: part.id,
				node: <VeloxyQuietToolNote part={part} />,
			});
			continue;
		}
		if (part.type === "tool-result" && part.error) {
			nodes.push({
				key: part.toolCallId,
				node: (
					<p className="text-[11px] leading-snug text-destructive">{part.error}</p>
				),
			});
		}
	}
	flushSchemaBatch();

	return (
		<div className="space-y-2">
			{nodes.map((item) => (
				<div key={item.key}>{item.node}</div>
			))}
		</div>
	);
}

export function AskVeloxySidebar({
	connectionId,
	engine,
	databaseName,
	selectedTable,
	connections,
	modelLabel,
	apiKey,
	isConfigured,
	activeWorkspace = "query",
	fixErrorContext,
	onClearFixErrorContext,
	chartContext,
	onClearChartContext,
	onSelectConnection,
	onNewConnection,
	onClose,
	onOpenSettings,
	onConfirmRun,
	onInsertSql,
	onReplaceSql,
	onOpenTabWithSql,
	onPinToDashboard,
}: AskVeloxySidebarProps) {
	const { t } = useTranslation();
	const entranceMotionClass =
		"motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-1 motion-safe:duration-200 motion-safe:ease-out motion-reduce:animate-none motion-reduce:opacity-100";

	const [prompt, setPrompt] = useState("");
	const [activeThreadId, setActiveThreadId] = useState<string>(() => crypto.randomUUID());
	const boundConnectionRef = useRef<string | null>(null);
	const scrollRef = useRef<HTMLDivElement>(null);
	const promptRef = useRef<HTMLTextAreaElement>(null);
	const lastDispatchedFixRef = useRef<string | null>(null);
	const lastDispatchedChartRef = useRef<string | null>(null);

	const threadsQuery = useVeloxyThreadsQuery(connectionId, databaseName);
	const threads = threadsQuery.data ?? [];
	const touchThread = useTouchVeloxyThreadMutation();
	const deleteThread = useDeleteVeloxyThreadMutation();

	useEffect(() => {
		if (!connectionId) {
			boundConnectionRef.current = null;
			return;
		}
		if (threadsQuery.isLoading) return;
		if (boundConnectionRef.current === connectionId) return;
		boundConnectionRef.current = connectionId;
		setActiveThreadId(threads[0]?.id ?? crypto.randomUUID());
	}, [connectionId, threads, threadsQuery.isLoading]);

	const veloxyBaseUrl = useSettings((s) => s.veloxyBaseUrl);

	const chat = useVeloxyChat({
		threadId: activeThreadId,
		connectionId,
		engine,
		databaseName,
		targetTable: selectedTable
			? { schema: selectedTable.schema, name: selectedTable.name }
			: null,
		model: modelLabel,
		apiKey,
		baseUrl: veloxyBaseUrl,
	});

	const isPending = chat.isLoading;
	const errorMessage = chat.error?.message ?? null;

	useEffect(() => {
		if (!fixErrorContext?.sql || !fixErrorContext?.errorMessage || !isConfigured || isPending) {
			return;
		}
		const key = `${fixErrorContext.sql.trim()}:::${fixErrorContext.errorMessage.trim()}`;
		if (lastDispatchedFixRef.current === key) return;
		lastDispatchedFixRef.current = key;

		const errorPrompt = [
			"Please diagnose and fix this SQL query error:",
			"",
			"```sql",
			fixErrorContext.sql.trim(),
			"```",
			"",
			"Error output:",
			fixErrorContext.errorMessage.trim(),
			"",
			"Please check the schema, explain what failed, and provide the fixed SQL query.",
		].join("\n");

		onClearFixErrorContext?.();
		void chat.sendMessage(errorPrompt);
	}, [fixErrorContext, isConfigured, isPending, chat, onClearFixErrorContext]);

	useEffect(() => {
		if (!chartContext?.sql || !isConfigured || isPending) return;
		if (lastDispatchedChartRef.current === chartContext.requestId) return;
		lastDispatchedChartRef.current = chartContext.requestId;
		onClearChartContext?.();
		void chat.sendMessage(buildChartContextPrompt(chartContext));
	}, [chartContext, isConfigured, isPending, chat, onClearChartContext]);

	const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);

	const handleCopySql = useCallback(async (sql: string) => {
		try {
			await navigator.clipboard.writeText(sql);
			notifySuccess("SQL copied");
		} catch {
			// Clipboard may be unavailable in some environments.
		}
	}, []);

	const handleCopyMessage = useCallback(async (messageId: string, text: string) => {
		try {
			await navigator.clipboard.writeText(text);
			setCopiedMessageId(messageId);
			notifySuccess("Response copied");
			setTimeout(() => {
				setCopiedMessageId((prev) => (prev === messageId ? null : prev));
			}, 2000);
		} catch {
			// Clipboard may be unavailable
		}
	}, []);

	const sqlActions = useMemo<VeloxySqlActions>(
		() => ({
			onCopy: (sql) => void handleCopySql(sql),
			onInsert: onInsertSql,
			onReplace: onReplaceSql,
			onNewTab: onOpenTabWithSql,
		}),
		[handleCopySql, onInsertSql, onReplaceSql, onOpenTabWithSql],
	);

	const lastMessage = chat.messages.at(-1);
	const lastTextLength = partText(lastMessage?.parts ?? []).length;
	const lastToolParts =
		lastMessage?.role === "assistant"
			? lastMessage.parts.filter((part): part is ToolCallPart => part.type === "tool-call")
			: [];
	useToolStallClock(lastToolParts);
	const toolsStalled = lastToolParts.some((part) => toolStatusLabel(part) === "stalled");

	useEffect(() => {
		if (!isPending || !toolsStalled) return;
		chat.stop();
	}, [chat, isPending, toolsStalled]);

	const { isUserScrolledUp, scrollToBottom } = usePacedScroll(
		scrollRef,
		[chat.messages.length, lastMessage?.id, lastTextLength, isPending, errorMessage],
	);

	const sendChat = async () => {
		const naturalPrompt = prompt.trim();
		if (!isConfigured || isPending || naturalPrompt.length === 0) return;
		setPrompt("");
		await chat.sendMessage(naturalPrompt);
	};

	return (
		<div className="flex h-full min-h-0 w-full flex-col bg-background">
			<header className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-2 py-1.5">
				<div className="flex min-w-0 flex-1 items-center gap-1.5 leading-tight">
					<span className="flex size-5 shrink-0 items-center justify-center text-muted-foreground">
						<RobotIcon className="size-3.5" weight="duotone" aria-hidden />
					</span>
					<span className="text-[11px] font-semibold text-foreground shrink-0">Ask Veloxy</span>
					<VeloxyConnectionSelector
						activeConnectionId={connectionId}
						activeEngine={engine}
						activeDatabaseName={databaseName}
						connections={connections}
						onSelectConnection={onSelectConnection}
						onNewConnection={onNewConnection}
					/>
					{activeWorkspace ? (
						<span className="rounded border border-border/70 bg-muted/40 px-1 py-0.2 text-[9px] font-medium uppercase tracking-wider text-muted-foreground">
							{activeWorkspace}
						</span>
					) : null}
				</div>
				<div className="flex shrink-0 items-center gap-0.5">
					<VeloxyHistoryPopover
						threads={threads}
						activeThreadId={activeThreadId}
						disabled={isPending || !connectionId}
						onSelectThread={(id) => {
							if (!connectionId || id === activeThreadId) return;
							setActiveThreadId(id);
							touchThread.mutate({ id, connectionId });
						}}
						onDeleteThread={(id) => {
							if (!connectionId) return;
							const remaining = threads.filter((thread) => thread.id !== id);
							deleteThread.mutate({ id, connectionId });
							if (id === activeThreadId) {
								setActiveThreadId(remaining[0]?.id ?? crypto.randomUUID());
							}
						}}
					/>
					<Button
						type="button"
						variant="ghost"
						size="sm"
						className="h-6 px-1.5 text-[10px] font-medium text-muted-foreground hover:text-foreground"
						disabled={isPending || !connectionId}
						onClick={() => setActiveThreadId(crypto.randomUUID())}
					>
						New
					</Button>
					<Button
						type="button"
						variant="ghost"
						size="icon-sm"
						className="size-6 text-muted-foreground hover:text-foreground"
						aria-label={t("veloxy.closeAskVeloxy")}
						onClick={onClose}
					>
						<XIcon className="size-3.5" />
					</Button>
				</div>
			</header>

			<div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
				<div
					ref={scrollRef}
					role="log"
					aria-relevant="additions"
					aria-busy={isPending}
					className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
				>
					<div className="px-3 pb-3 pt-3">
					{!isConfigured ? (
						<div className="mb-4 rounded-md border border-amber-500/35 bg-amber-500/[0.07] p-3 text-[12px] leading-relaxed text-amber-950 dark:text-amber-100">
							<div className="flex gap-2">
								<WarningCircleIcon
									className="mt-0.5 size-4 shrink-0 opacity-80"
									aria-hidden
								/>
								<div>
									<p className="font-medium">{t("veloxy.notConfigured")}</p>
									<p className="mt-1 text-[11px] text-amber-900/80 dark:text-amber-100/75">
										{t("veloxy.configureDesc")}
									</p>
									<div className="mt-3 flex flex-wrap gap-2">
										<Button
											variant="outline"
											size="sm"
											className="h-7 border-amber-500/40 bg-background/60 text-[11px] hover:bg-background"
											onClick={onOpenSettings}
										>
											{t("veloxy.openSettings")}
										</Button>
									</div>
								</div>
							</div>
						</div>
					) : null}

					{chat.messages.length === 0 && isConfigured ? (
						<div className="flex flex-col px-1 py-4">
							<div className="flex flex-col items-center justify-center gap-2 px-2 text-center">
								<div className="flex size-9 items-center justify-center rounded-lg border border-border bg-muted/35 text-muted-foreground">
									<DatabaseIcon className="size-4" weight="duotone" aria-hidden />
								</div>
								<div className="max-w-[16.5rem] space-y-1">
									<p className="text-[13px] font-medium text-foreground">
										{t("veloxy.schemaAwareCopilot")}
									</p>
									<p className="text-[11px] leading-relaxed text-muted-foreground">
										{t("veloxy.schemaAwareCopilotDesc")}
									</p>
								</div>
							</div>
							<VeloxyStarterPrompts
								activeWorkspace={activeWorkspace}
								disabled={isPending}
								onSelectPrompt={(text) => {
									setPrompt(text);
									promptRef.current?.focus();
								}}
							/>
						</div>
					) : null}

					<div className="flex flex-col gap-3">
						{chat.messages.map((message: UIMessage, index) => {
							const isLast = index === chat.messages.length - 1;
							const streaming = isPending && isLast && message.role === "assistant";
							// Chart safety net: user asked for a chart but the model never
							// called propose_chart — chart its final SQL locally instead.
							const previousMessage = index > 0 ? chat.messages[index - 1] : null;
							const autoChartSql = (() => {
								if (message.role !== "assistant" || streaming) return null;
								if (!previousMessage || previousMessage.role !== "user") return null;
								if (!hasChartIntent(partText(previousMessage.parts))) return null;
								const hasChartProposal = message.parts.some(
									(part) =>
										part.type === "tool-call" &&
										part.name === "propose_chart" &&
										parseProposeChartOutput(part.output) != null,
								);
								if (hasChartProposal) return null;
								return latestSqlFromParts(message.parts);
							})();
							return (
								<div
									key={message.id}
									className={cn(
										entranceMotionClass,
										message.role === "user" ? "flex justify-end" : "group",
									)}
								>
									<div
										className={cn(
											"w-full rounded-md text-[12px] leading-relaxed ring-1 transition-colors",
											message.role === "user"
												? "max-w-[min(100%,22rem)] ring-border/50 bg-muted/15 px-2.5 py-2 text-muted-foreground dark:bg-muted/10"
												: "max-w-full ring-border/80 bg-muted/30 px-3 py-2.5 text-foreground dark:bg-muted/25",
										)}
									>
										<div className="mb-1.5 flex items-center justify-between gap-2">
											<p
												className={cn(
													"text-[10px] font-semibold uppercase tracking-[0.14em]",
													message.role === "user"
														? "text-muted-foreground/75"
														: "text-muted-foreground",
												)}
											>
												{message.role === "user" ? "You" : "Veloxy"}
											</p>
											<div className="flex items-center gap-1">
												{streaming ? null : message.role === "assistant" ? (
													<div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
														<button
															type="button"
															onClick={() => handleCopyMessage(message.id, partText(message.parts))}
															className="flex size-5 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
															title="Copy response markdown"
														>
															{copiedMessageId === message.id ? (
																<CheckIcon className="size-3 text-emerald-500" />
															) : (
																<CopyIcon className="size-3" />
															)}
														</button>
														{isLast && !isPending ? (
															<button
																type="button"
																onClick={() => void chat.reload()}
																className="flex size-5 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
																title="Regenerate response"
															>
																<ArrowsClockwiseIcon className="size-3" />
															</button>
														) : null}
													</div>
												) : null}
											</div>
										</div>

										{message.role === "user" ? (
											<p className="wrap-break-word text-[12px] leading-relaxed">
												{partText(message.parts)}
											</p>
										) : (
											<>
												<AssistantParts
													parts={message.parts}
													streaming={streaming}
													sqlActions={sqlActions}
													sqlActionsDisabled={isPending}
													connectionId={connectionId}
													onRunSql={(sql) => void onConfirmRun(sql)}
													onPinToDashboard={onPinToDashboard}
												/>
												{streaming ? <VeloxyActivityLine parts={message.parts} /> : null}
												{autoChartSql ? (
													<VeloxyAutoChart
														messageId={message.id}
														sql={autoChartSql}
														connectionId={connectionId}
														isLast={isLast}
														disabled={isPending}
														onCopySql={sqlActions.onCopy}
														onInsertSql={sqlActions.onInsert}
														onPinToDashboard={(next) =>
															onPinToDashboard?.(pinOptionsFromProposal(next))
														}
													/>
												) : null}
											</>
										)}
										{message.role === "assistant" && !streaming
											? (() => {
													const sql = latestSqlFromParts(message.parts);
													if (!sql) return null;
													return (
														<div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-border/60 pt-3">
															<Button
																variant="default"
																size="sm"
																className="h-7 gap-1 text-[11px]"
																disabled={isPending}
																onClick={() => {
																	onReplaceSql(sql);
																	notifySuccess("SQL applied to active editor");
																}}
															>
																Use this SQL
															</Button>
															<Button
																variant="secondary"
																size="sm"
																className="h-7 text-[11px]"
																disabled={isPending}
																onClick={() => {
																	void onConfirmRun(sql);
																}}
															>
																Run
															</Button>
														</div>
													);
												})()
											: null}
									</div>
								</div>
							);
						})}
					</div>

					{isPending && !chat.messages.some((message) => message.role === "assistant" && message === lastMessage) ? (
						<div
							className={cn("mr-5 mt-3", entranceMotionClass)}
							aria-live="polite"
							aria-atomic="true"
						>
							<div className="rounded-md border border-border/80 bg-muted/20 px-3 py-2.5 ring-1 ring-border/60">
								<p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
									Veloxy
								</p>
								<div className="mt-2 text-foreground/80">
									<LatticeLoader
										label="Thinking"
										status="working"
										pattern="orbit"
										shape="round"
										cellSize={5}
										gap={2}
										fontSize={12}
										showTimer
									/>
								</div>
							</div>
						</div>
					) : null}

					{errorMessage ? (
						<div
							className={cn(
								"mt-3 rounded-md border border-destructive/35 bg-destructive/10 px-2.5 py-2 text-[12px] leading-relaxed text-destructive space-y-2",
								entranceMotionClass,
							)}
							role="alert"
						>
							<p>{errorMessage}</p>
						</div>
					) : null}
				</div>
			</div>

			{isUserScrolledUp && isPending ? (
				<button
					type="button"
					onClick={() => scrollToBottom("smooth")}
					className="absolute bottom-20 right-4 z-20 flex items-center gap-1 rounded-full border border-border/80 bg-background/95 px-2.5 py-1 text-[10px] font-medium text-foreground shadow-lg backdrop-blur-sm transition hover:bg-accent animate-in fade-in-0 slide-in-from-bottom-2 duration-150"
				>
					<span>↓ Resume Scroll</span>
				</button>
			) : null}
		</div>

		<div className="shrink-0 border-t border-border bg-background px-3 py-2.5">
			<VeloxyPromptBar
				value={prompt}
				onChange={setPrompt}
				onSend={() => void sendChat()}
				onStop={() => chat.stop()}
				busy={isPending}
				disabled={!isConfigured}
				placeholder="Message Veloxy…"
				selectedTable={selectedTable}
				databaseName={databaseName}
				activeWorkspace={activeWorkspace}
				inputRef={promptRef}
				modelSlot={<VeloxyModelSelector onOpenSettings={onOpenSettings} />}
			/>
		</div>
		</div>
	);
}
