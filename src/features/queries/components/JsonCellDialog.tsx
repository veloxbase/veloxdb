import { javascript } from "@codemirror/lang-javascript";
import { EditorView } from "@codemirror/view";
import CodeMirror from "@uiw/react-codemirror";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { formatJsonValue } from "@/features/queries/json-cell";
import { resolveTheme, useSettings } from "@/lib/settings";

type JsonCellDialogProps = {
	/** Raw cell value; dialog is open while non-null. */
	value: string | null;
	title?: string;
	onOpenChange: (open: boolean) => void;
};

export function JsonCellDialog({ value, title, onOpenChange }: JsonCellDialogProps) {
	const { t } = useTranslation();
	const isDark = useSettings((s) => resolveTheme(s.theme) === "dark");
	const extensions = useMemo(() => [javascript(), EditorView.lineWrapping], []);
	const formatted = useMemo(
		() => (value === null ? "" : formatJsonValue(value)),
		[value],
	);

	return (
		<Dialog open={value !== null} onOpenChange={onOpenChange}>
			<DialogContent className="flex max-h-[80vh] max-w-2xl flex-col gap-3">
				<DialogHeader>
					<DialogTitle>{title ?? t("editor.jsonView")}</DialogTitle>
				</DialogHeader>
				<div className="min-h-0 flex-1 overflow-auto rounded border border-border">
					<CodeMirror
						value={formatted}
						theme={isDark ? "dark" : "light"}
						extensions={extensions}
						readOnly
						editable={false}
						basicSetup={{ lineNumbers: true, foldGutter: true }}
					/>
				</div>
				<div className="flex justify-end">
					<Button
						size="sm"
						variant="outline"
						onClick={() => navigator.clipboard.writeText(formatted)}
					>
						{t("editor.copyJson")}
					</Button>
				</div>
			</DialogContent>
		</Dialog>
	);
}
