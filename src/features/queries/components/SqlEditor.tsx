import { useEffect, useMemo, useRef } from "react";
import CodeMirror, { type ReactCodeMirrorRef } from "@uiw/react-codemirror";
import { EditorView, keymap } from "@codemirror/view";
import { sql, PostgreSQL, MySQL, SQLite, MSSQL, Cassandra, StandardSQL } from "@codemirror/lang-sql";
import { javascript } from "@codemirror/lang-javascript";
import { autocompletion } from "@codemirror/autocomplete";
import { setDiagnostics, type Diagnostic } from "@codemirror/lint";
import type { Extension } from "@codemirror/state";

import type { QueryEditorMetadata, SqlDiagnostic } from "@/data/types";
import {
	buildSqlSchema,
	createMongoCompletionSource,
	createRedisCompletionSource,
} from "@/features/queries/lib/codemirror-completions";

type SqlEditorProps = {
	value: string;
	isDark: boolean;
	onChange: (value: string) => void;
	onRun: () => void;
	onRunStatement: (sql: string) => void;
	/** Language mode. Defaults to "sql" for relational, "json" / "mongo" for MongoDB, "plaintext" / "redis" for Redis. */
	language?: string;
	metadata?: QueryEditorMetadata;
	diagnostics?: SqlDiagnostic[];
};

type SqlStatementRange = { start: number; end: number };

function isWordChar(value: string) {
	return /[A-Za-z0-9_]/.test(value);
}

function parseDollarTag(sql: string, startIndex: number): { tag: string; end: number } | null {
	if (sql[startIndex] !== "$") return null;
	let cursor = startIndex + 1;
	while (cursor < sql.length && sql[cursor] !== "$") {
		const current = sql[cursor];
		if (!current || !isWordChar(current)) return null;
		cursor += 1;
	}
	if (cursor >= sql.length || sql[cursor] !== "$") return null;
	return { tag: sql.slice(startIndex, cursor + 1), end: cursor + 1 };
}

function getStatementRanges(sql: string): SqlStatementRange[] {
	const ranges: SqlStatementRange[] = [];
	let start = 0;
	let i = 0;
	let inSingle = false;
	let inDouble = false;
	let inLineComment = false;
	let blockDepth = 0;
	let dollarTag: string | null = null;

	while (i < sql.length) {
		const current = sql[i];
		const next = sql[i + 1];
		if (!current) break;

		if (inLineComment) {
			if (current === "\n") inLineComment = false;
			i += 1;
			continue;
		}
		if (blockDepth > 0) {
			if (current === "/" && next === "*") {
				blockDepth += 1;
				i += 2;
				continue;
			}
			if (current === "*" && next === "/") {
				blockDepth -= 1;
				i += 2;
				continue;
			}
			i += 1;
			continue;
		}
		if (dollarTag) {
			if (sql.startsWith(dollarTag, i)) {
				i += dollarTag.length;
				dollarTag = null;
				continue;
			}
			i += 1;
			continue;
		}
		if (inSingle) {
			if (current === "'" && next === "'") {
				i += 2;
				continue;
			}
			if (current === "'") inSingle = false;
			i += 1;
			continue;
		}
		if (inDouble) {
			if (current === '"' && next === '"') {
				i += 2;
				continue;
			}
			if (current === '"') inDouble = false;
			i += 1;
			continue;
		}

		if (current === "-" && next === "-") {
			inLineComment = true;
			i += 2;
			continue;
		}
		if (current === "/" && next === "*") {
			blockDepth = 1;
			i += 2;
			continue;
		}
		if (current === "'") {
			inSingle = true;
			i += 1;
			continue;
		}
		if (current === '"') {
			inDouble = true;
			i += 1;
			continue;
		}
		if (current === "$") {
			const parsed = parseDollarTag(sql, i);
			if (parsed) {
				dollarTag = parsed.tag;
				i = parsed.end;
				continue;
			}
		}
		if (current === ";") {
			ranges.push({ start, end: i });
			start = i + 1;
			i += 1;
			continue;
		}
		i += 1;
	}

	ranges.push({ start, end: sql.length });
	return ranges;
}

function resolveStatementFromOffset(sql: string, offset: number): string {
	const ranges = getStatementRanges(sql);
	const safeOffset = Math.max(0, Math.min(offset, sql.length));
	for (const range of ranges) {
		if (safeOffset >= range.start && safeOffset <= range.end) {
			return sql.slice(range.start, range.end).trim();
		}
	}
	return "";
}

export function SqlEditor({
	value,
	isDark,
	onChange,
	onRun,
	onRunStatement,
	language = "sql",
	metadata,
	diagnostics,
}: SqlEditorProps) {
	const cmRef = useRef<ReactCodeMirrorRef>(null);

	const isMongo = language === "json" || language === "mongo" || language === "mongodb";
	const isRedis = language === "redis" || language === "plaintext";

	const { schema, tables } = useMemo(() => buildSqlSchema(metadata), [metadata]);

	const languageExtension = useMemo<Extension>(() => {
		if (isMongo) {
			return [
				javascript(),
				autocompletion({
					override: [createMongoCompletionSource(metadata)],
					defaultKeymap: true,
				}),
			];
		}

		if (isRedis) {
			return [
				autocompletion({
					override: [createRedisCompletionSource()],
					defaultKeymap: true,
				}),
			];
		}

		const dialect =
			language === "mysql"
				? MySQL
				: language === "sqlite" || language === "duckdb" || language === "libsql" || language === "turso"
					? SQLite
					: language === "mssql" || language === "azuresql"
						? MSSQL
						: language === "cassandra" || language === "scylladb"
							? Cassandra
							: language === "clickhouse"
								? StandardSQL
								: PostgreSQL;

		return sql({ dialect, schema, tables });
	}, [isMongo, isRedis, language, schema, tables, metadata]);

	const keymapExtension = useMemo<Extension>(() => {
		return keymap.of([
			{
				key: "Mod-Enter",
				run: () => {
					onRun();
					return true;
				},
			},
			{
				key: "Mod-Shift-Enter",
				run: (view) => {
					const selection = view.state.sliceDoc(
						view.state.selection.main.from,
						view.state.selection.main.to,
					).trim();
					if (selection) {
						onRunStatement(selection);
						return true;
					}
					const offset = view.state.selection.main.head;
					const text = view.state.doc.toString();
					const stmt = resolveStatementFromOffset(text, offset);
					onRunStatement(stmt || text.trim());
					return true;
				},
			},
		]);
	}, [onRun, onRunStatement]);

	const editorTheme = useMemo<Extension>(() => {
		return EditorView.theme({
			"&": {
				height: "100%",
				fontSize: "0.93rem",
				fontFamily: '"JetBrains Mono", monospace',
				backgroundColor: "transparent",
			},
			".cm-scroller": {
				overflow: "auto",
				fontFamily: '"JetBrains Mono", monospace',
				lineHeight: "1.6",
				padding: "8px 0",
			},
			".cm-content": {
				caretColor: isDark ? "#ffffff" : "#09090b",
			},
			"&.cm-focused .cm-cursor": {
				borderLeftColor: isDark ? "#ffffff" : "#09090b",
			},
			".cm-gutters": {
				backgroundColor: "transparent",
				borderRight: isDark
					? "1px solid rgba(255, 255, 255, 0.08)"
					: "1px solid rgba(0, 0, 0, 0.08)",
				color: isDark ? "rgba(255, 255, 255, 0.35)" : "rgba(0, 0, 0, 0.35)",
				paddingRight: "8px",
			},
			".cm-activeLine": {
				backgroundColor: isDark ? "rgba(255, 255, 255, 0.04)" : "rgba(0, 0, 0, 0.04)",
			},
			".cm-activeLineGutter": {
				backgroundColor: "transparent",
				color: isDark ? "rgba(255, 255, 255, 0.85)" : "rgba(0, 0, 0, 0.85)",
			},
			".cm-selectionBackground, ::selection": {
				backgroundColor: isDark
					? "rgba(255, 255, 255, 0.15) !important"
					: "rgba(0, 0, 0, 0.12) !important",
			},
			".cm-tooltip": {
				backgroundColor: isDark ? "#18181b" : "#ffffff",
				border: isDark ? "1px solid #27272a" : "1px solid #e4e4e7",
				borderRadius: "6px",
				boxShadow: "0 4px 16px rgba(0, 0, 0, 0.2)",
			},
			".cm-tooltip-autocomplete": {
				"& > ul": {
					maxHeight: "260px",
					fontFamily: '"JetBrains Mono", monospace',
					fontSize: "0.85rem",
				},
				"& > ul > li": {
					padding: "4px 8px",
					display: "flex",
					alignItems: "center",
					gap: "6px",
				},
				"& > ul > li[aria-selected]": {
					backgroundColor: isDark ? "#27272a" : "#f4f4f5",
					color: isDark ? "#ffffff" : "#09090b",
				},
			},
		});
	}, [isDark]);

	const extensions = useMemo<Extension[]>(() => {
		return [
			languageExtension,
			keymapExtension,
			editorTheme,
			EditorView.lineWrapping,
		];
	}, [languageExtension, keymapExtension, editorTheme]);

	useEffect(() => {
		const view = cmRef.current?.view;
		if (!view) return;

		if (!diagnostics || !diagnostics.length) {
			view.dispatch(setDiagnostics(view.state, []));
			return;
		}

		const doc = view.state.doc;
		const cmDiagnostics: Diagnostic[] = diagnostics.map((item) => {
			const lineNum = Math.max(1, Math.min(doc.lines, item.line ?? 1));
			const line = doc.line(lineNum);
			const from = Math.min(doc.length, line.from + Math.max(0, (item.column ?? 1) - 1));
			const endLineNum = Math.max(lineNum, Math.min(doc.lines, item.endLine ?? lineNum));
			const endLine = doc.line(endLineNum);
			const to = Math.min(
				doc.length,
				Math.max(from + 1, endLine.from + Math.max(0, (item.endColumn ?? 1) - 1)),
			);
			return {
				from,
				to,
				severity:
					item.severity === "warning"
						? "warning"
						: item.severity === "info"
							? "info"
							: "error",
				message: item.message,
			};
		});

		view.dispatch(setDiagnostics(view.state, cmDiagnostics));
	}, [diagnostics]);

	return (
		<CodeMirror
			ref={cmRef}
			value={value}
			height="100%"
			theme={isDark ? "dark" : "light"}
			extensions={extensions}
			onChange={onChange}
			indentWithTab={true}
			basicSetup={{
				lineNumbers: true,
				highlightActiveLineGutter: true,
				highlightSpecialChars: true,
				history: true,
				foldGutter: true,
				drawSelection: true,
				dropCursor: true,
				allowMultipleSelections: true,
				indentOnInput: true,
				syntaxHighlighting: true,
				bracketMatching: true,
				closeBrackets: true,
				autocompletion: true,
				rectangularSelection: true,
				crosshairCursor: true,
				highlightActiveLine: true,
				highlightSelectionMatches: true,
				closeBracketsKeymap: true,
				defaultKeymap: true,
				searchKeymap: true,
				historyKeymap: true,
				foldKeymap: true,
				completionKeymap: true,
				lintKeymap: true,
			}}
		/>
	);
}
