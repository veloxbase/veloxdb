import type { RefObject } from "react";
import {
	DotsThreeIcon,
	MagnifyingGlassIcon,
	SidebarSimpleIcon,
	XIcon,
} from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { useTranslation } from "react-i18next";

type ColumnVisibilityItem = {
	id: string;
	label: string;
	visible: boolean;
	canHide: boolean;
};

type ResultsToolbarProps = {
	columns: ColumnVisibilityItem[];
	canEdit: boolean;
	isDirty: boolean;
	isBusy: boolean;
	onToggleColumn: (columnId: string, visible: boolean) => void;
	onRefresh: () => void;
	onCopy: () => void;
	onCopyMarkdown?: () => void;
	onCopySqlInsert?: () => void;
	onDownloadCsv: () => void;
	onDownloadJson: () => void;
	onSave: () => void;
	/** When set, show "Add row" for direct INSERT into the selected table. */
	onAddRow?: () => void;
	/** Shown when the inline insert row is visible. */
	insertRowVisible?: boolean;
	onInsertRow?: () => void;
	onCancelInsert?: () => void;
	insertBusy?: boolean;
	insertDisabled?: boolean;
	selectionCount?: number;
	onDeleteRows?: () => void;
	deleteBusy?: boolean;
	deleteDisabledReason?: string;
	/** opens the Chart Builder for this result. Hidden when omitted. */
	onCreateChart?: () => void;
	/** Disables the Create chart button while shown (no result, non-SQL engine, etc.). */
	canCreateChart?: boolean;
	/** Quick filter query state */
	filterQuery?: string;
	onFilterQueryChange?: (query: string) => void;
	filterMatchCount?: number;
	totalRowCount?: number;
	filterInputRef?: RefObject<HTMLInputElement | null>;
	/** Cell inspector drawer toggle */
	isInspectorOpen?: boolean;
	onToggleInspector?: () => void;
};

export function ResultsToolbar({
	columns,
	canEdit,
	isDirty,
	isBusy,
	onToggleColumn,
	onRefresh,
	onCopy,
	onCopyMarkdown,
	onCopySqlInsert,
	onDownloadCsv,
	onDownloadJson,
	onSave,
	onAddRow,
	insertRowVisible,
	onInsertRow,
	onCancelInsert,
	insertBusy,
	insertDisabled,
	selectionCount,
	onDeleteRows,
	deleteBusy,
	deleteDisabledReason,
	onCreateChart,
	canCreateChart = true,
	filterQuery = "",
	onFilterQueryChange,
	filterMatchCount,
	totalRowCount,
	filterInputRef,
	isInspectorOpen,
	onToggleInspector,
}: ResultsToolbarProps) {
	const { t } = useTranslation();

	return (
		<div className="min-w-0 overflow-x-auto border-b border-border bg-muted/20 px-3 py-2">
			<div className="flex min-w-full w-max items-center justify-between gap-3">
				<div className="flex shrink-0 items-center gap-2">
					{insertRowVisible && onInsertRow ? (
						<>
							<Button
								variant="default"
								size="xs"
								onClick={onInsertRow}
								disabled={isBusy || insertBusy || insertDisabled}
							>
								{insertBusy ? t("editor.inserting") : t("editor.insert")}
							</Button>
							{onCancelInsert ? (
								<Button
									variant="outline"
									size="xs"
									onClick={onCancelInsert}
									disabled={isBusy || insertBusy}
								>
									{t("editor.cancelInsert")}
								</Button>
							) : null}
						</>
					) : null}
					<Button
						variant="outline"
						size="xs"
						onClick={onRefresh}
						disabled={isBusy}
					>
						{t("editor.refresh")}
					</Button>

					{/* Quick Filter Search */}
					{onFilterQueryChange ? (
						<div className="relative flex items-center">
							<MagnifyingGlassIcon className="pointer-events-none absolute left-2 size-3 text-muted-foreground" />
							<input
								ref={filterInputRef}
								type="text"
								placeholder={t("editor.filterResults", "Filter rows (⌘F)...")}
								value={filterQuery}
								onChange={(e) => onFilterQueryChange(e.target.value)}
								className="h-6 w-36 sm:w-44 rounded-none border border-border bg-background pl-6 pr-5 text-xs text-foreground outline-none transition-colors focus:border-ring placeholder:text-muted-foreground/60"
							/>
							{filterQuery ? (
								<button
									type="button"
									onClick={() => onFilterQueryChange("")}
									className="absolute right-1.5 flex size-3.5 items-center justify-center text-muted-foreground hover:text-foreground"
									title="Clear filter"
								>
									<XIcon className="size-2.5" />
								</button>
							) : null}
						</div>
					) : null}

					{filterQuery && filterMatchCount !== undefined && totalRowCount !== undefined ? (
						<span className="rounded-xs bg-muted/80 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground select-none">
							{filterMatchCount} / {totalRowCount}
						</span>
					) : null}

					<Button variant="outline" size="xs" onClick={onDownloadCsv}>
						{t("editor.exportCsv")}
					</Button>
					<Button variant="outline" size="xs" onClick={onDownloadJson}>
						{t("editor.exportJson")}
					</Button>

					{onCreateChart ? (
						<Button
							variant="outline"
							size="xs"
							onClick={onCreateChart}
							disabled={!canCreateChart}
							title={!canCreateChart ? t("editor.createChartDisabled") : undefined}
						>
							{t("editor.createChart")}
						</Button>
					) : null}
				</div>

				<div className="flex shrink-0 items-center gap-2">
					<details className="relative shrink-0">
						<summary className="list-none">
							<Button variant={isInspectorOpen ? "secondary" : "outline"} size="xs" asChild>
								<span className="flex items-center gap-1 cursor-pointer">
									<DotsThreeIcon className="size-3" />
									{t("editor.moreActions")}
								</span>
							</Button>
						</summary>
						<div className="absolute right-0 z-20 mt-1 min-w-52 border border-border bg-background p-1 shadow-md">
							{onAddRow ? (
								<button type="button" onClick={onAddRow} disabled={isBusy} className="flex w-full px-2 py-1 text-left text-xs hover:bg-muted disabled:opacity-50">
									{t("editor.insertRow")}
								</button>
							) : null}
							{onDeleteRows ? (
								<button
									type="button"
									onClick={onDeleteRows}
									disabled={isBusy || deleteBusy || selectionCount === 0}
									title={deleteDisabledReason}
									className="flex w-full px-2 py-1 text-left text-xs text-destructive hover:bg-destructive/10 disabled:opacity-50"
								>
									{deleteBusy
										? t("editor.deleting")
										: `${t("editor.deleteRow")}${selectionCount ? ` (${selectionCount})` : ""}`}
								</button>
							) : null}
							<button type="button" onClick={onCopy} className="flex w-full items-center justify-between px-2 py-1 text-left text-xs hover:bg-muted">
								<span>Copy TSV</span>
								<span className="text-[10px] text-muted-foreground">Excel / Sheets</span>
							</button>
							{onCopyMarkdown ? (
								<button type="button" onClick={onCopyMarkdown} className="flex w-full items-center justify-between px-2 py-1 text-left text-xs hover:bg-muted">
									<span>Copy as Markdown</span>
								</button>
							) : null}
							{onCopySqlInsert ? (
								<button type="button" onClick={onCopySqlInsert} className="flex w-full items-center justify-between px-2 py-1 text-left text-xs hover:bg-muted">
									<span>Copy as SQL INSERT</span>
								</button>
							) : null}
							{onToggleInspector ? (
								<button type="button" onClick={onToggleInspector} className="flex w-full items-center gap-2 px-2 py-1 text-left text-xs hover:bg-muted">
									<SidebarSimpleIcon className="size-3" />
									{t("editor.inspector", "Inspector")}
								</button>
							) : null}
							<div className="mt-1 border-t border-border px-2 py-1">
								<div className="mb-1 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
									{t("editor.columns")}
								</div>
								<div className="max-h-48 space-y-1 overflow-auto">
									{columns.map((column) => (
										<label
											key={column.id}
											className="flex cursor-pointer items-center gap-2 text-xs text-foreground"
										>
											<input
												type="checkbox"
												className="size-3.5 cursor-pointer"
												checked={column.visible}
												disabled={!column.canHide}
												onChange={(event) =>
													onToggleColumn(column.id, event.target.checked)
												}
											/>
											<span className="truncate">{column.label}</span>
										</label>
									))}
								</div>
							</div>
						</div>
					</details>

					<Button
						size="xs"
						onClick={onSave}
						disabled={isBusy || !canEdit || !isDirty}
						variant={isDirty ? "default" : "outline"}
					>
						{isBusy ? t("editor.saving") : t("editor.save")}
					</Button>
				</div>
			</div>
		</div>
	);
}
