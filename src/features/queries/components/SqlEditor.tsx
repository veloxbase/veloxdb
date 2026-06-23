import Editor from "@monaco-editor/react";
import type { Monaco } from "@monaco-editor/react";
import type { editor, IDisposable, languages } from "monaco-editor";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import type { QueryEditorMetadata, SqlDiagnostic } from "@/data/types";

type SqlEditorProps = {
	value: string;
	isDark: boolean;
	onChange: (value: string) => void;
	onRun: () => void;
	onRunStatement: (sql: string) => void;
	/** Language mode for Monaco. Defaults to "sql" for relational, "json" for MongoDB. */
	language?: string;
	metadata?: QueryEditorMetadata;
	diagnostics?: SqlDiagnostic[];
};

function completionItemsFromMetadata(
	metadata: QueryEditorMetadata | undefined,
): languages.CompletionItem[] {
	if (!metadata) return [];
	const items: languages.CompletionItem[] = [];
	for (const table of metadata.tables) {
		const fqTable = `${table.schema}.${table.name}`;
		items.push({
			label: fqTable,
			kind: 18,
			insertText: fqTable,
			detail: "table",
			range: undefined as any,
		});
		for (const column of table.columns) {
			items.push({
				label: `${fqTable}.${column.name}`,
				kind: 5,
				insertText: `${table.name}.${column.name}`,
				detail: column.dataType,
				range: undefined as any,
			});
		}
	}
	for (const fn of metadata.functions) {
		items.push({
			label: `${fn.schema}.${fn.name}`,
			kind: 1,
			insertText: `${fn.name}($1)`,
			insertTextRules: 4,
			detail: fn.returnType,
			range: undefined as any,
		});
	}
	return items;
}

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
	const { t } = useTranslation()
	const [editorInstance, setEditorInstance] =
		useState<editor.IStandaloneCodeEditor | null>(null);
	const [monacoInstance, setMonacoInstance] = useState<Monaco | null>(null);
	const providerRef = useRef<IDisposable | null>(null);
	const markersOwner = "veloxdb-sql-lint";

	useEffect(() => {
		if (!editorInstance || !monacoInstance) return;
		const model = editorInstance.getModel();
		if (!model) return;
		const markers: editor.IMarkerData[] = (diagnostics ?? []).map((item) => {
			const line = Math.max(1, item.line ?? 1);
			const col = Math.max(1, item.column ?? 1);
			return {
				message: item.message,
				severity:
					item.severity === "warning" ? 4 : item.severity === "info" ? 2 : 8,
				startLineNumber: line,
				startColumn: col,
				endLineNumber: Math.max(line, item.endLine ?? line),
				endColumn: Math.max(col + 1, item.endColumn ?? col + 1),
			};
		});
		monacoInstance.editor.setModelMarkers(model, markersOwner, markers);
	}, [diagnostics, editorInstance, monacoInstance]);

	const resolveCurrentStatement = (instance: editor.IStandaloneCodeEditor): string => {
		const model = instance.getModel();
		if (!model) return "";

		const selection = instance.getSelection();
		const selectedText = selection ? model.getValueInRange(selection).trim() : "";
		if (selectedText) return selectedText;

		const position = instance.getPosition();
		if (!position) return model.getValue().trim();
		const text = model.getValue();
		const cursorOffset = model.getOffsetAt(position);
		return resolveStatementFromOffset(text, cursorOffset);
	};

	const handleMount = (
		instance: editor.IStandaloneCodeEditor,
		monaco: Monaco,
	) => {
		setEditorInstance(instance);
		setMonacoInstance(monaco);
		providerRef.current?.dispose();
		providerRef.current = instance.getModel()
			? monaco.languages.registerCompletionItemProvider("sql", {
					provideCompletionItems: (model: any, position: any) => {
						const word = model.getWordUntilPosition(position);
						const range = {
							startLineNumber: position.lineNumber,
							endLineNumber: position.lineNumber,
							startColumn: word.startColumn,
							endColumn: word.endColumn,
						};
						const suggestions = completionItemsFromMetadata(metadata).map((item) => ({
							...item,
							range,
						}));
						return { suggestions };
					},
			  })
			: null;

		instance.addAction({
			id: "veloxdb-run-query",
			label: t("editor.runQueryBtn"),
			keybindings: [2048 | 3, 256 | 3],
			run: () => onRun(),
		});
		instance.addAction({
			id: "veloxdb-run-statement",
			label: t("editor.runStatement"),
			keybindings: [1024 | 3],
			run: () => onRunStatement(resolveCurrentStatement(instance)),
		});
	};

	useEffect(() => {
		providerRef.current?.dispose();
		if (!editorInstance || !monacoInstance) return;
		providerRef.current = monacoInstance.languages.registerCompletionItemProvider("sql", {
			provideCompletionItems: (model: any, position: any) => {
				const word = model.getWordUntilPosition(position);
				const range = {
					startLineNumber: position.lineNumber,
					endLineNumber: position.lineNumber,
					startColumn: word.startColumn,
					endColumn: word.endColumn,
				};
				return {
					suggestions: completionItemsFromMetadata(metadata).map((item) => ({
						...item,
						range,
					})),
				};
			},
		});
		return () => providerRef.current?.dispose();
	}, [metadata, editorInstance, monacoInstance]);

	return (
		<Editor
			height="100%"
			language={language}
			defaultLanguage={language}
			theme={isDark ? "vs-dark" : "vs-light"}
			value={value}
			onMount={handleMount}
			onChange={(nextValue) => onChange(nextValue ?? "")}
			options={{
				automaticLayout: true,
				minimap: { enabled: false },
				fontFamily: "JetBrains Mono Variable, monospace",
				fontSize: 13,
				padding: { top: 16, bottom: 16 },
				lineNumbersMinChars: 3,
				scrollBeyondLastLine: false,
				wordWrap: "on",
				tabSize: 2,
			}}
		/>
	);
}
