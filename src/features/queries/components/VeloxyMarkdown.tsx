import ReactMarkdown, { type Components } from "react-markdown";

import { cn } from "@/lib/utils";

type VeloxyMarkdownProps = {
	content: string;
	className?: string;
};

const markdownComponents: Components = {
	p: ({ className, ...props }) => (
		<p
			className={cn("my-1 text-[12px] leading-relaxed text-inherit", className)}
			{...props}
		/>
	),
	ul: ({ className, ...props }) => (
		<ul
			className={cn("my-1 list-disc pl-4 text-inherit", className)}
			{...props}
		/>
	),
	ol: ({ className, ...props }) => (
		<ol
			className={cn("my-1 list-decimal pl-4 text-inherit", className)}
			{...props}
		/>
	),
	li: ({ className, ...props }) => (
		<li
			className={cn(
				"my-0.5 text-[12px] leading-relaxed text-inherit",
				className,
			)}
			{...props}
		/>
	),
	strong: ({ className, ...props }) => (
		<strong
			className={cn("font-semibold text-inherit", className)}
			{...props}
		/>
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
		const text = String(children ?? "");
		const isInline = !text.includes("\n");
		if (isInline) {
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
		}
		return (
			<code
				className={cn(
					"font-mono text-[11px] leading-snug text-inherit",
					className,
				)}
				{...props}
			>
				{children}
			</code>
		);
	},
	pre: ({ className, ...props }) => (
		<pre
			className={cn(
				"my-2 max-h-52 overflow-auto rounded-sm border border-border/60 bg-background/50 p-2 font-mono text-[11px] leading-snug text-inherit [scrollbar-width:thin] dark:bg-background/30",
				className,
			)}
			{...props}
		/>
	),
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

export function VeloxyMarkdown({ content, className }: VeloxyMarkdownProps) {
	return (
		<div className={cn("text-inherit", className)}>
			<ReactMarkdown components={markdownComponents}>{content}</ReactMarkdown>
		</div>
	);
}
