import { javascript } from "@codemirror/lang-javascript";
import { EditorView } from "@codemirror/view";
import CodeMirror from "@uiw/react-codemirror";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import {
	formatJsonValue,
	JSON_NOT_OBJECT_ERROR,
	parseJsonInput,
} from "@/features/queries/json-cell";
import { notifyError } from "@/lib/error-notifier";
import { resolveTheme, useSettings } from "@/lib/settings";

type JsonCellDialogProps = {
	/** Raw cell value (pending edit applied); dialog is open while non-null. */
	value: string | null;
	title?: string;
	/** When set, the dialog is editable and Apply passes the compact JSON here. */
	onApply?: (compactJson: string) => void;
	onOpenChange: (open: boolean) => void;
};

function JsonCellBody({
	value,
	onApply,
	onClose,
}: {
	value: string;
	onApply?: (compactJson: string) => void;
	onClose: () => void;
}) {
	const { t } = useTranslation();
	const isDark = useSettings((s) => resolveTheme(s.theme) === "dark");
	const extensions = useMemo(() => [javascript(), EditorView.lineWrapping], []);
	const formatted = useMemo(() => formatJsonValue(value), [value]);
	const [draft, setDraft] = useState(formatted);
	const [error, setError] = useState<string | null>(null);
	const [copied, setCopied] = useState(false);
	const copyTimeoutRef = useRef<number | null>(null);
	const editable = onApply !== undefined;

	useEffect(
		() => () => {
			if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
		},
		[],
	);

	const copy = async () => {
		try {
			await navigator.clipboard.writeText(editable ? draft : formatted);
			setCopied(true);
			if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
			copyTimeoutRef.current = window.setTimeout(() => setCopied(false), 1200);
		} catch (e) {
			notifyError(e, { title: t("editor.copyFailed"), category: "internal" });
		}
	};

	const apply = () => {
		// Unchanged text: skip, otherwise compacting would create a spurious pending edit.
		if (draft === formatted) {
			onClose();
			return;
		}
		const parsed = parseJsonInput(draft);
		if (!parsed.ok) {
			setError(
				parsed.error === JSON_NOT_OBJECT_ERROR
					? t("editor.jsonNotObject")
					: parsed.error,
			);
			return;
		}
		onApply?.(parsed.value);
		onClose();
	};

	return (
		<>
			<div className="min-h-0 flex-1 overflow-auto rounded border border-border">
				<CodeMirror
					value={draft}
					theme={isDark ? "dark" : "light"}
					extensions={extensions}
					readOnly={!editable}
					editable={editable}
					onChange={(next) => {
						setDraft(next);
						setError(null);
					}}
					basicSetup={{ lineNumbers: true, foldGutter: true }}
				/>
			</div>
			{error ? (
				<div className="text-xs text-destructive">
					{t("editor.invalidJson")}: {error}
				</div>
			) : null}
			<div className="flex justify-end gap-2">
				<Button size="sm" variant="outline" onClick={copy}>
					{copied ? t("editor.copiedJson") : t("editor.copyJson")}
				</Button>
				{editable ? (
					<Button size="sm" onClick={apply}>
						{t("editor.applyJson")}
					</Button>
				) : null}
			</div>
		</>
	);
}

export function JsonCellDialog({
	value,
	title,
	onApply,
	onOpenChange,
}: JsonCellDialogProps) {
	const { t } = useTranslation();
	return (
		<Dialog open={value !== null} onOpenChange={onOpenChange}>
			<DialogContent className="flex max-h-[80vh] sm:max-w-4xl flex-col gap-3">
				<DialogHeader>
					<DialogTitle>{title ?? t("editor.jsonView")}</DialogTitle>
				</DialogHeader>
				{value !== null ? (
					<JsonCellBody
						value={value}
						onApply={onApply}
						onClose={() => onOpenChange(false)}
					/>
				) : null}
			</DialogContent>
		</Dialog>
	);
}
