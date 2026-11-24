import { isValidElement, type ReactNode } from "react";
import { Markdown, type MarkdownComponents } from "@tanstack/markdown/react";
import { streamingMarkdownExtension } from "@tanstack/markdown/extensions/streaming";

import { veloxyHighlighter } from "@/features/queries/veloxy/highlighter";
import { isSqlLanguage } from "@/features/queries/veloxy/sql-preview";
import {
	SqlDraftToolbar,
	type SqlDraftToolbarProps,
} from "@/features/queries/veloxy/sql-draft-toolbar";
import { cn } from "@/lib/utils";

export type VeloxySqlActions = Pick<
	SqlDraftToolbarProps,
	"onCopy" | "onInsert" | "onReplace" | "onNewTab"
>;

type VeloxyMarkdownProps = {
	content: string;
	className?: string;
	streaming?: boolean;
	sqlActions?: VeloxySqlActions;
	sqlActionsDisabled?: boolean;
};

function collectText(node: ReactNode): string {
	if (node == null || typeof node === "boolean") return "";
	if (typeof node === "string" || typeof node === "number") return String(node);
	if (Array.isArray(node)) return node.map(collectText).join("");
	if (isValidElement<{ children?: ReactNode }>(node)) {
		return collectText(node.props.children);
	}
	return "";
}

function VeloxyCodeTokens({ code, lang }: { code: string; lang: string }) {
	const { tokens } = veloxyHighlighter.tokenize(code, { lang });
	return (
		<>
			{tokens.map((token, index) => (
				<span
					key={`${index}:${token.className ?? "text"}:${token.value.length}`}
					className={token.className ? `th-${token.className}` : undefined}
				>
					{token.value}
				</span>
			))}
		</>
	);
}

const streamingExtensions = [streamingMarkdownExtension()];

function markdownComponents(input: {
	sqlActions?: VeloxySqlActions;
	sqlActionsDisabled?: boolean;
}): MarkdownComponents {
	return {
		p: ({ className, ...props }) => (
			<p
				className={cn("my-1 text-[12px] leading-relaxed text-inherit", className)}
				{...props}
			/>
		),
		ul: ({ className, ...props }) => (
			<ul className={cn("my-1 list-disc pl-4 text-inherit", className)} {...props} />
		),
		ol: ({ className, ...props }) => (
			<ol className={cn("my-1 list-decimal pl-4 text-inherit", className)} {...props} />
		),
		li: ({ className, ...props }) => (
			<li
				className={cn("my-0.5 text-[12px] leading-relaxed text-inherit", className)}
				{...props}
			/>
		),
		strong: ({ className, ...props }) => (
			<strong className={cn("font-semibold text-inherit", className)} {...props} />
		),
		em: ({ className, ...props }) => (
			<em className={cn("italic text-inherit", className)} {...props} />
		),
		a: ({ className, ...props }) => (
			<a
				className={cn(
					"wrap-break-word text-foreground/85 underline underline-offset-2 transition-colors hover:text-foreground",
					className,
				)}
				target="_blank"
				rel="noopener noreferrer"
				{...props}
			/>
		),
		code: ({ className, children, ...props }) => {
			const isBlock = typeof className === "string" && className.includes("language-");
			if (isBlock) {
				return (
					<code className={className} {...props}>
						{children}
					</code>
				);
			}
			return (
				<code
					className={cn(
						"rounded-sm border border-border/70 bg-muted/20 px-1 py-0.5 font-mono text-[11px] leading-none text-inherit",
						className,
					)}
					{...props}
				>
					{children}
				</code>
			);
		},
		pre: ({ className, children, ...props }) => {
			const lang = String(
				("data-lang" in props && props["data-lang"]) || "plaintext",
			);
			const code = collectText(children);
			return (
				<div className="my-2">
					<pre
						className={cn(
							"veloxy-code th-code animate-phosphor-bloom my-0 max-h-52 overflow-auto rounded-sm border border-border/60 bg-background/50 p-2 font-mono text-[11px] leading-snug text-inherit [scrollbar-width:thin] dark:bg-background/30",
							className,
						)}
						data-lang={lang}
						{...props}
					>
						<code className={`language-${lang}`}>
							<VeloxyCodeTokens code={code} lang={lang} />
						</code>
					</pre>
					{isSqlLanguage(lang) && input.sqlActions && code.trim() ? (
						<SqlDraftToolbar
							sql={code.trim()}
							disabled={input.sqlActionsDisabled}
							{...input.sqlActions}
						/>
					) : null}
				</div>
			);
		},
		h1: ({ className, ...props }) => (
			<h3
				className={cn(
					"mt-2 text-xs font-semibold uppercase tracking-wide text-inherit",
					className,
				)}
				{...props}
			/>
		),
		h2: ({ className, ...props }) => (
			<h3
				className={cn(
					"mt-2 text-xs font-semibold uppercase tracking-wide text-inherit",
					className,
				)}
				{...props}
			/>
		),
		h3: ({ className, ...props }) => (
			<h3
				className={cn(
					"mt-2 text-xs font-semibold uppercase tracking-wide text-inherit",
					className,
				)}
				{...props}
			/>
		),
		blockquote: ({ className, ...props }) => (
			<blockquote
				className={cn(
					"my-2 border-l-2 border-border/70 bg-muted/15 px-2 py-1 text-inherit",
					className,
				)}
				{...props}
			/>
		),
	};
}

export function VeloxyMarkdown({
	content,
	className,
	streaming = false,
	sqlActions,
	sqlActionsDisabled,
}: VeloxyMarkdownProps) {
	return (
		<div className={cn("text-inherit", className)}>
			<Markdown
				allowHtml={false}
				frontmatter={false}
				headingIds={false}
				extensions={streaming ? streamingExtensions : undefined}
				components={markdownComponents({ sqlActions, sqlActionsDisabled })}
			>
				{content}
			</Markdown>
		</div>
	);
}

export function VeloxyHighlightedSql({
	sql,
	className,
	sqlActions,
	sqlActionsDisabled,
}: {
	sql: string;
	className?: string;
	sqlActions?: VeloxySqlActions;
	sqlActionsDisabled?: boolean;
}) {
	return (
		<div className={className}>
			<pre className="veloxy-code th-code my-0 max-h-52 overflow-auto rounded-sm border border-border/60 bg-background/50 p-2 font-mono text-[11px] leading-snug [scrollbar-width:thin] dark:bg-background/30">
				<code className="language-sql">
					<VeloxyCodeTokens code={sql} lang="sql" />
				</code>
			</pre>
			{sqlActions ? (
				<SqlDraftToolbar sql={sql} disabled={sqlActionsDisabled} {...sqlActions} />
			) : null}
		</div>
	);
}
