import {
	ArrowsLeftRightIcon,
	ChatCircleDotsIcon,
	CopyIcon,
	DatabaseIcon,
	LightningIcon,
	PlusIcon,
	RobotIcon,
	SquareIcon,
	WarningCircleIcon,
	XIcon,
} from "@phosphor-icons/react";
import {
	useCallback,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type {
	AskVeloxyChatResponse,
	AskVeloxyConversationMessage,
	AskVeloxyConversationResponse,
	AskVeloxyResponse,
	VeloxyStreamChunk,
} from "@/data/types";
import { VeloxyMarkdown } from "@/features/queries/components/VeloxyMarkdown";
import { useVeloxyStream } from "@/features/queries/hooks/useVeloxyStream";
import { notifySuccess } from "@/lib/error-notifier";
import { cn } from "@/lib/utils";

export type AskVeloxySubmitResult = {
	response: AskVeloxyResponse;
	decision: "auto-ran" | "needs-confirmation";
	decisionReason?: string;
	pendingSql?: string;
};

type ChatMessage = AskVeloxyConversationMessage & {
	clientNonce?: number;
	streaming?: boolean;
	stoppedEarly?: boolean;
	result?: AskVeloxyResponse;
	decision?: AskVeloxySubmitResult["decision"];
	decisionReason?: string;
	pendingSql?: string;
	suggestions?: string[];
	warnings?: string[];
	needsSqlGeneration?: boolean;
	needsClarification?: boolean;
};

type AskVeloxySidebarProps = {
	isPending: boolean;
	modelLabel: string;
	contextTableLabel?: string | null;
	isConfigured: boolean;
	onClose: () => void;
	onOpenSettings: () => void;
	onChatSubmit: (
		naturalPrompt: string,
		requestId: string,
	) => Promise<AskVeloxyChatResponse>;
	onActionSubmit: (naturalPrompt: string) => Promise<AskVeloxySubmitResult>;
	onLoadConversation: () => Promise<AskVeloxyConversationResponse>;
	onClearConversation: () => Promise<void>;
	onConfirmRun: (sql: string) => Promise<void>;
	onInsertSql: (sql: string) => void;
	onReplaceSql: (sql: string) => void;
	onOpenTabWithSql: (sql: string) => void;
	onCancelRequest?: () => Promise<void>;
	errorMessage: string | null;
};

function extractTextFromUnknown(value: unknown): string | null {
	if (typeof value === "string") {
		const normalized = value.trim();
		return normalized.length > 0 ? normalized : null;
	}
	if (!value || typeof value !== "object") return null;

	const record = value as Record<string, unknown>;
	for (const key of ["message", "reply", "content", "text"]) {
		const text = extractTextFromUnknown(record[key]);
		if (text) return text;
	}
	for (const key of ["output", "response", "data", "result"]) {
		const text = extractTextFromUnknown(record[key]);
		if (text) return text;
	}
	return null;
}

function unescapeJsonFragment(raw: string): string {
	let out = "";
	for (let i = 0; i < raw.length; i += 1) {
		const ch = raw[i];
		if (ch !== "\\") {
			out += ch;
			continue;
		}
		const next = raw[i + 1];
		if (next === "n") {
			out += "\n";
			i += 1;
		} else if (next === "t") {
			out += "\t";
			i += 1;
		} else if (next === "r") {
			out += "\r";
			i += 1;
		} else if (next === '"') {
			out += '"';
			i += 1;
		} else if (next === "\\") {
			out += "\\";
			i += 1;
		} else if (next != null) {
			out += `\\${next}`;
			i += 1;
		} else {
			out += "\\";
		}
	}
	return out;
}

function extractJsonMessageField(
	raw: string,
	allowPartial: boolean,
): string | null {
	const unwrapped = raw
		.trim()
		.replace(/^```json\s*/i, "")
		.replace(/\s*```$/, "");
	for (const key of ["message", "reply", "content", "text"]) {
		const marker = `"${key}"`;
		const markerIdx = unwrapped.indexOf(marker);
		if (markerIdx < 0) continue;
		let idx = markerIdx + marker.length;
		while (idx < unwrapped.length && /\s/.test(unwrapped[idx] ?? "")) idx += 1;
		if (unwrapped[idx] !== ":") continue;
		idx += 1;
		while (idx < unwrapped.length && /\s/.test(unwrapped[idx] ?? "")) idx += 1;
		if (unwrapped[idx] !== '"') continue;
		idx += 1;
		const start = idx;
		let escaped = false;
		while (idx < unwrapped.length) {
			const ch = unwrapped[idx];
			if (escaped) {
				escaped = false;
				idx += 1;
				continue;
			}
			if (ch === "\\") {
				escaped = true;
				idx += 1;
				continue;
			}
			if (ch === '"') {
				const fragment = unwrapped.slice(start, idx);
				try {
					const decoded = JSON.parse(`"${fragment}"`);
					if (typeof decoded === "string" && decoded.trim())
						return decoded.trim();
				} catch {
					const text = unescapeJsonFragment(fragment).trim();
					if (text) return text;
				}
				break;
			}
			idx += 1;
		}
		if (allowPartial && start < unwrapped.length) {
			const text = unescapeJsonFragment(unwrapped.slice(start)).trim();
			if (text) return text;
		}
	}
	return null;
}

function looksLikeJsonResponse(raw: string): boolean {
	const trimmed = raw.trimStart();
	return trimmed.startsWith("{") || trimmed.startsWith("```");
}

function normalizeAssistantMessage(raw: string): string {
	const trimmed = raw.trim();
	if (!trimmed) return "";

	const unwrapped = trimmed.replace(/^```json\s*/i, "").replace(/\s*```$/, "");
	try {
		const parsed = JSON.parse(unwrapped);
		return extractTextFromUnknown(parsed) ?? trimmed;
	} catch {
		const extracted =
			extractJsonMessageField(trimmed, false) ??
			extractJsonMessageField(trimmed, true);
		if (extracted) return extracted;
		if (looksLikeJsonResponse(trimmed)) return "";
		return trimmed;
	}
}

function messageBodyIsSqlDraft(message: ChatMessage): boolean {
	if (message.role !== "assistant" || message.mode !== "action") return false;
	const t = message.text.trimStart().toLowerCase();
	return (
		t.startsWith("select") ||
		t.startsWith("with") ||
		t.startsWith("insert") ||
		t.startsWith("update") ||
		t.startsWith("delete") ||
		t.startsWith("explain")
	);
}

function truncateSuggestion(text: string, max = 72): string {
	if (text.length <= max) return text;
	return `${text.slice(0, max - 1).trimEnd()}…`;
}

function ChatWarningsBanner({ warnings }: { warnings: string[] }) {
	if (!warnings.length) return null;
	return (
		<div className="mt-2 rounded-md border border-amber-500/30 bg-amber-500/[0.06] px-2 py-1.5 text-amber-950 dark:text-amber-50">
			<p className="text-[10px] font-semibold uppercase tracking-wide text-amber-900/90 dark:text-amber-100/90">
				Review
			</p>
			<ul className="mt-1 space-y-0.5 text-[11px] leading-snug">
				{warnings.map((warning) => (
					<li key={warning}>{warning}</li>
				))}
			</ul>
		</div>
	);
}

type SqlDraftToolbarProps = {
	sql: string;
	disabled?: boolean;
	onCopy: (sql: string) => void;
	onInsert: (sql: string) => void;
	onReplace: (sql: string) => void;
	onNewTab: (sql: string) => void;
};

function SqlDraftToolbar({
	sql,
	disabled,
	onCopy,
	onInsert,
	onReplace,
	onNewTab,
}: SqlDraftToolbarProps) {
	return (
		<div className="mt-1.5 flex flex-wrap items-center gap-1">
			<Button
				type="button"
				variant="ghost"
				size="sm"
				className="h-6 px-1.5 text-[10px] text-muted-foreground hover:text-foreground"
				disabled={disabled}
				onClick={() => onCopy(sql)}
			>
				<CopyIcon className="size-3" aria-hidden />
				Copy
			</Button>
			<Button
				type="button"
				variant="ghost"
				size="sm"
				className="h-6 px-1.5 text-[10px] text-muted-foreground hover:text-foreground"
				disabled={disabled}
				onClick={() => onInsert(sql)}
			>
				<PlusIcon className="size-3" aria-hidden />
				Insert
			</Button>
			<Button
				type="button"
				variant="ghost"
				size="sm"
				className="h-6 px-1.5 text-[10px] text-muted-foreground hover:text-foreground"
				disabled={disabled}
				onClick={() => onReplace(sql)}
			>
				<ArrowsLeftRightIcon className="size-3" aria-hidden />
				Replace
			</Button>
			<Button
				type="button"
				variant="ghost"
				size="sm"
				className="h-6 px-1.5 text-[10px] text-muted-foreground hover:text-foreground"
				disabled={disabled}
				onClick={() => onNewTab(sql)}
			>
				New tab
			</Button>
		</div>
	);
}

export function AskVeloxySidebar({
	isPending,
	modelLabel,
	contextTableLabel,
	isConfigured,
	onClose,
	onOpenSettings,
	onChatSubmit,
	onActionSubmit,
	onLoadConversation,
	onClearConversation,
	onConfirmRun,
	onInsertSql,
	onReplaceSql,
	onOpenTabWithSql,
	onCancelRequest,
	errorMessage,
}: AskVeloxySidebarProps) {
	const { t } = useTranslation()
	const entranceMotionClass =
		"motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-1 motion-safe:duration-200 motion-safe:ease-out motion-reduce:animate-none motion-reduce:opacity-100";

	const messageEnterSeq = useRef(0);
	const nextClientNonce = () => {
		messageEnterSeq.current += 1;
		return messageEnterSeq.current;
	};

	const [prompt, setPrompt] = useState("");
	const [messages, setMessages] = useState<ChatMessage[]>([]);
	const [typingState, setTypingState] = useState<{
		messageId: string;
		visibleChars: number;
		totalChars: number;
	} | null>(null);
	const scrollRef = useRef<HTMLDivElement>(null);
	const promptRef = useRef<HTMLTextAreaElement>(null);
	const typingFrameRef = useRef<number | null>(null);
	const activeTypingMessageIdRef = useRef<string | null>(null);
	const activeRequestIdRef = useRef<string | null>(null);
	const typingStartTimeRef = useRef(0);
	const prefersReducedMotionRef = useRef(false);
	const scrollDigest = `${messages.length}:${messages.at(-1)?.id ?? ""}:${messages.at(-1)?.text.length ?? 0}:${isPending}:${errorMessage ?? ""}`;

	const handleStreamChunk = useCallback((chunk: VeloxyStreamChunk) => {
		if (chunk.requestId !== activeRequestIdRef.current) return;

		setMessages((prev) =>
			prev.map((message) => {
				if (message.id !== chunk.requestId) return message;
				if (chunk.done) {
					const finalText = chunk.message
						? normalizeAssistantMessage(chunk.message)
						: message.text;
					return {
						...message,
						text: finalText,
						streaming: false,
						stoppedEarly: chunk.warnings?.some((w) =>
							w.toLowerCase().includes("stopped"),
						),
						sqlDraft: chunk.sqlDraft ?? message.sqlDraft,
						suggestions: chunk.suggestions ?? message.suggestions,
						warnings: chunk.warnings ?? message.warnings,
						needsSqlGeneration:
							chunk.needsSqlGeneration ?? message.needsSqlGeneration,
						needsClarification:
							chunk.needsClarification ?? message.needsClarification,
					};
				}
				if (!chunk.delta) return message;
				return {
					...message,
					text: message.text + chunk.delta,
				};
			}),
		);
	}, []);

	useVeloxyStream({ onChunk: handleStreamChunk });

	const handleCopySql = useCallback(async (sql: string) => {
		try {
			await navigator.clipboard.writeText(sql);
			notifySuccess("SQL copied");
		} catch {
			// Clipboard may be unavailable in some environments.
		}
	}, []);

	useEffect(() => {
		let mounted = true;
		void onLoadConversation()
			.then((response) => {
				if (!mounted) return;
				setMessages(
					response.messages.map((message) => ({
						...message,
						text:
							message.role === "assistant"
								? normalizeAssistantMessage(message.text)
								: message.text,
						suggestions: [],
						warnings: [],
					})),
				);
			})
			.catch(() => {
				// Parent handles surfaced errors.
			});
		return () => {
			mounted = false;
		};
	}, [onLoadConversation]);

	useEffect(() => {
		const media = window.matchMedia("(prefers-reduced-motion: reduce)");
		const update = () => {
			prefersReducedMotionRef.current = media.matches;
		};
		update();
		media.addEventListener("change", update);
		return () => {
			media.removeEventListener("change", update);
		};
	}, []);

	useEffect(() => {
		const latest = messages.at(-1);
		if (!latest || latest.role !== "assistant" || latest.mode !== "chat")
			return;
		if (latest.streaming) return;
		if (latest.clientNonce == null) return;
		if (activeTypingMessageIdRef.current === latest.id) return;
		if (prefersReducedMotionRef.current || latest.text.length < 24) {
			activeTypingMessageIdRef.current = latest.id;
			setTypingState(null);
			return;
		}

		if (typingFrameRef.current != null) {
			window.cancelAnimationFrame(typingFrameRef.current);
			typingFrameRef.current = null;
		}
		activeTypingMessageIdRef.current = latest.id;
		const totalChars = latest.text.length;
		const stepChars = Math.max(1, Math.ceil(totalChars / 36));
		const durationMs = Math.min(2200, Math.max(600, totalChars * 14));
		typingStartTimeRef.current = performance.now();
		setTypingState({
			messageId: latest.id,
			visibleChars: Math.min(stepChars, totalChars),
			totalChars,
		});

		const tick = (now: number) => {
			const elapsed = now - typingStartTimeRef.current;
			const progress = Math.min(1, elapsed / durationMs);
			const rawChars = Math.ceil(progress * totalChars);
			const steppedChars = Math.min(
				totalChars,
				Math.ceil(rawChars / stepChars) * stepChars,
			);
			setTypingState((prev) => {
				if (!prev || prev.messageId !== latest.id) return prev;
				if (steppedChars >= totalChars) return null;
				if (prev.visibleChars === steppedChars) return prev;
				return { ...prev, visibleChars: steppedChars };
			});
			if (steppedChars < totalChars) {
				typingFrameRef.current = window.requestAnimationFrame(tick);
			} else {
				typingFrameRef.current = null;
			}
		};
		typingFrameRef.current = window.requestAnimationFrame(tick);

		return () => {
			if (typingFrameRef.current != null) {
				window.cancelAnimationFrame(typingFrameRef.current);
				typingFrameRef.current = null;
			}
		};
	}, [messages]);

	useEffect(() => {
		const latest = messages.at(-1);
		if (!latest?.needsClarification || latest.role !== "assistant") return;
		promptRef.current?.focus();
	}, [messages]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: scroll when transcript tail, pending row, or error changes
	useLayoutEffect(() => {
		const node = scrollRef.current;
		if (!node) return;
		node.scrollTo({ top: node.scrollHeight, behavior: "smooth" });
	}, [scrollDigest]);

	const appendUserMessage = (text: string, mode: "chat" | "action") => {
		const clientNonce = nextClientNonce();
		setMessages((prev) => [
			...prev,
			{
				id: crypto.randomUUID(),
				role: "user",
				mode,
				text,
				createdAt: Math.floor(Date.now() / 1000),
				clientNonce,
			},
		]);
	};

	const handleActionSubmit = async (seed: string) => {
		const actionPrompt = seed.trim();
		if (!actionPrompt) return;
		appendUserMessage(actionPrompt, "action");
		const result = await onActionSubmit(actionPrompt);
		const clientNonce = nextClientNonce();
		setMessages((prev) => [
			...prev,
			{
				id: crypto.randomUUID(),
				role: "assistant",
				mode: "action",
				text: result.response.sql,
				createdAt: Math.floor(Date.now() / 1000),
				clientNonce,
				result: result.response,
				decision: result.decision,
				decisionReason: result.decisionReason,
				pendingSql: result.pendingSql,
				sqlDraft: result.response.sql,
				suggestions: result.response.suggestions ?? [],
				warnings: result.response.warnings,
				needsSqlGeneration: false,
				needsClarification: false,
			},
		]);
	};

	const sendChat = async () => {
		const naturalPrompt = prompt.trim();
		if (!naturalPrompt) return;
		appendUserMessage(naturalPrompt, "chat");
		setPrompt("");

		const requestId = crypto.randomUUID();
		activeRequestIdRef.current = requestId;
		const clientNonce = nextClientNonce();
		setMessages((prev) => [
			...prev,
			{
				id: requestId,
				role: "assistant",
				mode: "chat",
				text: "",
				createdAt: Math.floor(Date.now() / 1000),
				clientNonce,
				streaming: true,
				suggestions: [],
				warnings: [],
			},
		]);

		try {
			const result = await onChatSubmit(naturalPrompt, requestId);
			const message = normalizeAssistantMessage(result.message);
			setMessages((prev) =>
				prev.map((entry) => {
					if (entry.id !== requestId) return entry;
					return {
						...entry,
						text: message || entry.text,
						streaming: false,
						sqlDraft: result.sqlDraft,
						suggestions: result.suggestions,
						warnings: result.warnings,
						needsSqlGeneration: result.needsSqlGeneration,
						needsClarification: result.needsClarification,
					};
				}),
			);
		} catch {
			setMessages((prev) => prev.filter((entry) => entry.id !== requestId));
		} finally {
			activeRequestIdRef.current = null;
		}
	};

	const handleSuggestionClick = (
		suggestion: string,
		event: React.MouseEvent<HTMLButtonElement>,
	) => {
		if (event.shiftKey) {
			appendUserMessage(suggestion, "chat");
			void onChatSubmit(suggestion, crypto.randomUUID()).catch(() => {
				// Parent handles surfaced errors.
			});
			return;
		}
		setPrompt(suggestion);
		promptRef.current?.focus();
	};

	const headerSubtitle = contextTableLabel
		? `${contextTableLabel} · ${modelLabel}`
		: modelLabel;

	return (
		<div className="flex h-full min-h-0 w-full flex-col bg-background">
			<header className="flex shrink-0 items-center gap-2 border-b border-border px-2 py-1">
				<span className="flex size-6 shrink-0 items-center justify-center text-muted-foreground">
					<RobotIcon className="size-3.5" weight="duotone" aria-hidden />
				</span>
				<div className="min-w-0 flex-1 leading-tight">
					<p className="truncate text-[11px] font-medium text-foreground">
						Ask Veloxy
						<span className="font-normal text-muted-foreground"> · </span>
						<span className="font-normal tabular-nums text-muted-foreground">
							{headerSubtitle}
						</span>
					</p>
				</div>
				<div className="flex shrink-0 items-center gap-0.5">
					<Button
						type="button"
						variant="ghost"
						size="sm"
						className="h-6 px-1.5 text-[10px] font-medium text-muted-foreground hover:text-foreground"
						disabled={isPending}
						onClick={async () => {
							try {
								await onClearConversation();
								setMessages([]);
							} catch {
								// Parent handles surfaced errors.
							}
						}}
					>
						New
					</Button>
					<span className="text-[9px] text-border" aria-hidden>
						·
					</span>
					<Button
						type="button"
						variant="ghost"
						size="sm"
						className="h-6 px-1.5 text-[10px] font-medium text-muted-foreground hover:text-foreground"
						disabled={isPending}
						onClick={async () => {
							try {
								await onClearConversation();
								setMessages([]);
							} catch {
								// Parent handles surfaced errors.
							}
						}}
					>
						Clear
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

			<div
				ref={scrollRef}
				role="log"
				aria-relevant="additions"
				aria-busy={isPending}
				className="min-h-0 flex-1 overflow-y-auto overscroll-contain scroll-smooth"
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
									<Button
										variant="outline"
										size="sm"
										className="mt-3 h-7 border-amber-500/40 bg-background/60 text-[11px] hover:bg-background"
										onClick={onOpenSettings}
									>
										{t("veloxy.openSettings")}
									</Button>
								</div>
							</div>
						</div>
					) : null}

					{messages.length === 0 && isConfigured ? (
						<div className="flex min-h-[min(40vh,12rem)] flex-col items-center justify-center gap-2 px-2 py-6 text-center">
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
					) : null}

					<div className="flex flex-col gap-3">
						{messages.map((message) => (
							<div
								key={message.id}
								className={cn(
									message.clientNonce != null && entranceMotionClass,
									message.role === "user" ? "flex justify-end" : "",
								)}
							>
								<div
									className={cn(
										"w-full rounded-md text-[12px] leading-relaxed ring-1 transition-colors",
										message.role === "user"
											? "max-w-[min(100%,22rem)] ring-border/50 bg-muted/15 px-2.5 py-2 text-muted-foreground dark:bg-muted/10"
											: "max-w-full ring-border/80 bg-muted/30 px-3 py-2.5 text-foreground dark:bg-muted/25",
										message.stoppedEarly &&
											"ring-amber-500/30 bg-amber-500/[0.04]",
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
										{message.mode === "action" ? (
											<span className="rounded border border-border bg-background/80 px-1.5 py-px text-[9px] font-medium uppercase tracking-wide text-muted-foreground">
												SQL
											</span>
										) : null}
										{message.streaming ? (
											<span className="rounded border border-border bg-background/80 px-1.5 py-px text-[9px] font-medium uppercase tracking-wide text-muted-foreground">
												Streaming
											</span>
										) : null}
									</div>

									{messageBodyIsSqlDraft(message) ? (
										<>
											<pre className="max-h-52 overflow-auto rounded-sm border border-border/60 bg-background/50 p-2 font-mono text-[11px] leading-snug text-foreground/95 [scrollbar-width:thin] dark:bg-background/30">
												{message.text}
											</pre>
											<SqlDraftToolbar
												sql={message.text}
												disabled={isPending}
												onCopy={(sql) => void handleCopySql(sql)}
												onInsert={onInsertSql}
												onReplace={onReplaceSql}
												onNewTab={onOpenTabWithSql}
											/>
										</>
									) : message.text ? (
										<VeloxyMarkdown
											content={
												message.streaming
													? message.text
													: typingState?.messageId === message.id
														? message.text.slice(
																0,
																Math.max(typingState.visibleChars, 1),
															)
														: message.text
											}
											className={cn(
												"wrap-break-word text-[12px] leading-relaxed",
												message.role === "user"
													? "text-muted-foreground"
													: "text-foreground",
											)}
										/>
									) : message.streaming ? (
										<p className="text-[11px] text-muted-foreground">…</p>
									) : null}
									{typingState?.messageId === message.id &&
									!message.streaming ? (
										<span
											className="mt-1 inline-flex h-4 items-center text-muted-foreground"
											aria-hidden
										>
											<span className="inline-block h-3 w-px animate-pulse bg-current" />
										</span>
									) : null}

									{message.mode === "chat" &&
									message.needsClarification &&
									message.role === "assistant" ? (
										<div className="mt-2 rounded-md border border-sky-500/30 bg-sky-500/[0.06] px-2 py-1.5 text-[11px] leading-snug text-sky-950 dark:text-sky-50">
											Veloxy needs a bit more detail before generating SQL.
										</div>
									) : null}

									{message.mode === "chat" &&
									message.role === "assistant" &&
									message.suggestions?.length ? (
										<div className="mt-2 flex flex-wrap gap-1.5">
											{message.suggestions.slice(0, 5).map((suggestion) => (
												<Button
													key={suggestion}
													type="button"
													variant="outline"
													size="sm"
													className="h-auto max-w-full whitespace-normal px-2 py-1 text-left text-[10px] leading-snug"
													disabled={isPending}
													title="Shift+click to send immediately"
													onClick={(event) =>
														handleSuggestionClick(suggestion, event)
													}
												>
													{truncateSuggestion(suggestion)}
												</Button>
											))}
										</div>
									) : null}

									{message.mode === "chat" &&
									message.role === "assistant" &&
									!message.result ? (
										<ChatWarningsBanner warnings={message.warnings ?? []} />
									) : null}

									{message.mode === "chat" &&
									message.sqlDraft &&
									!messageBodyIsSqlDraft(message) ? (
										<div className="mt-2 rounded-sm border border-dashed border-border bg-background/60 px-2 py-1.5">
											<p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
												SQL draft
											</p>
											<pre className="mt-1 max-h-32 overflow-auto font-mono text-[11px] leading-snug text-foreground [scrollbar-width:thin]">
												{message.sqlDraft}
											</pre>
											<SqlDraftToolbar
												sql={message.sqlDraft}
												disabled={isPending}
												onCopy={(sql) => void handleCopySql(sql)}
												onInsert={onInsertSql}
												onReplace={onReplaceSql}
												onNewTab={onOpenTabWithSql}
											/>
										</div>
									) : null}

									{message.result ? (
										<div className="mt-3 space-y-2 border-t border-border/70 pt-3 text-[11px]">
											<div className="flex flex-wrap items-center gap-2">
												<span className="rounded-sm border border-border bg-background/70 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
													{message.result.intent}
												</span>
												<span className="text-muted-foreground">
													Confidence
												</span>
												<span className="tabular-nums text-foreground/90">
													{Math.round(message.result.confidence * 100)}%
												</span>
												<div
													className="h-1 min-w-[3.5rem] flex-1 rounded-full bg-muted"
													role="progressbar"
													aria-valuenow={Math.round(
														message.result.confidence * 100,
													)}
													aria-valuemin={0}
													aria-valuemax={100}
													aria-label={t("veloxy.modelConfidence")}
												>
													<div
														className="h-full rounded-full bg-foreground/25 transition-[width] duration-300"
														style={{
															width: `${Math.min(100, Math.round(message.result.confidence * 100))}%`,
														}}
													/>
												</div>
											</div>
											<p className="text-[10px] text-muted-foreground">
												Tokens (est.){" "}
												<span className="tabular-nums text-foreground/80">
													{message.result.tokenStats.promptTokensEstimate}
												</span>
											</p>
											{message.result.explanation ? (
												<p className="text-[12px] leading-relaxed text-foreground/95">
													{message.result.explanation}
												</p>
											) : null}
											{message.result.suggestions?.length ? (
												<div className="rounded-sm border-l-2 border-muted-foreground/25 bg-muted/15 py-1.5 pl-2.5 pr-1">
													<p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
														Suggestions
													</p>
													<ul className="mt-1 space-y-1 text-[11px] text-muted-foreground">
														{message.result.suggestions.map((suggestion) => (
															<li key={suggestion} className="leading-snug">
																{suggestion}
															</li>
														))}
													</ul>
												</div>
											) : null}
											<ChatWarningsBanner
												warnings={
													message.warnings ?? message.result.warnings ?? []
												}
											/>
										</div>
									) : null}

									{message.mode === "chat" && message.role === "assistant" ? (
										<div className="mt-3 border-t border-border/60 pt-3">
											<div className="flex flex-wrap items-center gap-1.5">
												<Button
													variant={
														message.needsClarification ? "outline" : "default"
													}
													size="sm"
													className="h-7 gap-1 px-2.5 text-[11px] font-medium shadow-none"
													disabled={
														isPending ||
														message.needsClarification ||
														(!message.sqlDraft && !message.text.trim())
													}
													title={
														message.needsClarification
															? "Answer Veloxy's question first"
															: undefined
													}
													onClick={() => {
														void handleActionSubmit(
															message.sqlDraft ?? message.text,
														);
													}}
												>
													<LightningIcon className="size-3.5" aria-hidden />
													Generate SQL
												</Button>
												<Button
													variant="secondary"
													size="sm"
													className="h-7 text-[11px]"
													disabled={isPending || !message.sqlDraft}
													onClick={() => {
														if (!message.sqlDraft) return;
														void onConfirmRun(message.sqlDraft);
													}}
												>
													Run
												</Button>
												<div
													className="mx-0.5 hidden h-4 w-px bg-border sm:block"
													aria-hidden
												/>
												<Button
													variant="ghost"
													size="sm"
													className="h-7 text-[11px] text-muted-foreground hover:text-foreground"
													disabled={isPending}
													onClick={() => {
														const draft = message.sqlDraft ?? message.text;
														setPrompt(
															`Revise this SQL to be safer and faster:\n${draft}`,
														);
													}}
												>
													Revise
												</Button>
												<Button
													variant="ghost"
													size="sm"
													className="h-7 text-[11px] text-muted-foreground hover:text-foreground"
													disabled={isPending}
													onClick={() => {
														const draft = message.sqlDraft ?? message.text;
														setPrompt(
															`Explain plan-level tradeoffs for this SQL:\n${draft}`,
														);
													}}
												>
													Explain plan
												</Button>
											</div>
										</div>
									) : null}

									{message.decision === "auto-ran" ? (
										<p className="mt-2 flex items-center gap-1.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-400">
											<span
												className="size-1 rounded-full bg-current"
												aria-hidden
											/>
											Executed safely
										</p>
									) : null}
									{message.decision === "needs-confirmation" &&
									message.pendingSql ? (
										<div className="mt-3 rounded-md border border-amber-500/35 bg-amber-500/[0.05] p-2.5">
											<p className="text-[11px] font-medium leading-snug text-amber-950 dark:text-amber-100">
												{message.decisionReason ??
													t("veloxy.confirmationRequired")}
											</p>
											<Button
												variant="outline"
												size="sm"
												className="mt-2 h-7 border-amber-500/40 text-[11px]"
												onClick={() => {
													if (!message.pendingSql) return;
													void onConfirmRun(message.pendingSql);
												}}
											>
												Run with confirmation
											</Button>
										</div>
									) : null}
									{message.stoppedEarly ? (
										<p className="mt-2 text-[11px] font-medium text-amber-700 dark:text-amber-400">
											Stopped early — partial reply kept.
										</p>
									) : null}
								</div>
							</div>
						))}
					</div>

					{isPending && !messages.some((message) => message.streaming) ? (
						<div
							className={cn("mr-5 mt-3", entranceMotionClass)}
							aria-live="polite"
							aria-atomic="true"
						>
							<div className="rounded-md border border-border/80 bg-muted/20 px-3 py-2.5 ring-1 ring-border/60">
								<p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
									Veloxy
								</p>
								<div className="mt-2 flex items-center gap-2 text-[12px] text-muted-foreground">
									<span
										className="relative flex size-4 items-center justify-center"
										aria-hidden
									>
										<span className="absolute inline-flex size-2.5 animate-ping rounded-full bg-foreground/15 opacity-60" />
										<span className="relative inline-flex size-2 rounded-full bg-foreground/35" />
									</span>
									<span className="font-medium text-foreground/80">
										Working
									</span>
									<span className="text-muted-foreground">
										— reasoning and drafting a reply
									</span>
								</div>
							</div>
						</div>
					) : null}

					{errorMessage ? (
						<div
							className={cn(
								"mt-3 rounded-md border border-destructive/35 bg-destructive/10 px-2.5 py-2 text-[12px] leading-relaxed text-destructive",
								entranceMotionClass,
							)}
							role="alert"
						>
							{errorMessage}
						</div>
					) : null}
				</div>
			</div>

			<div className="shrink-0 border-t border-border bg-background px-3 py-2.5">
				<div className="rounded-md border border-input bg-background shadow-none focus-within:border-ring focus-within:ring-1 focus-within:ring-ring/40">
					<Textarea
						ref={promptRef}
						value={prompt}
						onChange={(event) => setPrompt(event.target.value)}
						placeholder="Message Veloxy…"
						disabled={!isConfigured || isPending}
						rows={3}
						className="min-h-[4.5rem] resize-none border-0 bg-transparent px-3 py-2.5 text-[13px] leading-relaxed shadow-none focus-visible:ring-0 md:text-[13px]"
						onKeyDown={(event) => {
							if (event.key !== "Enter") return;
							if (!(event.metaKey || event.ctrlKey)) return;
							event.preventDefault();
							if (!isConfigured || isPending || prompt.trim().length === 0)
								return;
							void sendChat();
						}}
					/>
				</div>
				<div className="mt-2 flex items-center justify-between gap-2">
					<p className="hidden text-[10px] text-muted-foreground sm:block">
						<span className="font-medium text-foreground/70">Ctrl</span>
						<span className="mx-0.5">/</span>
						<span className="font-medium text-foreground/70">⌘</span>
						<span className="mx-0.5">+</span>
						<span className="font-medium text-foreground/70">Enter</span>
						<span className="ml-1">to send</span>
					</p>
					<div className="ml-auto flex items-center gap-1.5">
						{isPending && onCancelRequest ? (
							<Button
								type="button"
								variant="outline"
								size="sm"
								className="h-7 gap-1 px-2.5 text-[11px] font-medium"
								onClick={() => void onCancelRequest()}
							>
								<SquareIcon className="size-3.5" aria-hidden />
								Stop
							</Button>
						) : null}
						<Button
							variant="default"
							size="sm"
							className="h-7 gap-1.5 px-3 text-[11px] font-medium"
							disabled={
								!isConfigured || isPending || prompt.trim().length === 0
							}
							onClick={() => void sendChat()}
						>
							<ChatCircleDotsIcon className="size-3.5" aria-hidden />
							Send
						</Button>
					</div>
				</div>
			</div>
		</div>
	);
}
