import { type RefObject, useState } from "react";
import {
	DotsThreeIcon,
	MagnifyingGlassIcon,
	SidebarSimpleIcon,
	XIcon,
} from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";

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
	const [moreOpen, setMoreOpen] = useState(false);
	const hideableColumns = columns.filter((column) => column.canHide);
	const visibleHideableCount = hideableColumns.filter(
		(column) => column.visible,
	).length;
	const hasHiddenColumns = visibleHideableCount < hideableColumns.length;
	/** Runs a menu action and closes the menu. */
	const runAndClose = (action: () => void) => () => {
		setMoreOpen(false);
		action();
	};
	const menuItemClass =
		"flex w-full items-center rounded-sm px-2 py-1.5 text-left text-xs hover:bg-muted disabled:pointer-events-none disabled:opacity-50";

	return (
		<div className="min-w-0 shrink-0 border-b border-border bg-muted/20 px-3 py-1.5">
			<div className="flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
				<div className="flex min-w-0 flex-wrap items-center gap-1.5">
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

				<div className="flex shrink-0 items-center gap-1.5">
					<Popover open={moreOpen} onOpenChange={setMoreOpen}>
						<PopoverTrigger asChild>
							<Button variant={isInspectorOpen ? "secondary" : "outline"} size="xs">
								<DotsThreeIcon className="size-3" />
								{t("editor.moreActions")}
								{hasHiddenColumns ? (
									<span className="tabular-nums text-muted-foreground">
										· {visibleHideableCount}/{hideableColumns.length}
									</span>
								) : null}
							</Button>
						</PopoverTrigger>
						<PopoverContent align="end" className="w-60 p-1">
							{onAddRow ? (
								<button type="button" onClick={runAndClose(onAddRow)} disabled={isBusy} className={menuItemClass}>
									{t("editor.insertRow")}
								</button>
							) : null}
							{onDeleteRows ? (
								<button
									type="button"
									onClick={runAndClose(onDeleteRows)}
									disabled={isBusy || deleteBusy || selectionCount === 0}
									title={deleteDisabledReason}
									className={`${menuItemClass} text-destructive hover:bg-destructive/10`}
								>
									{deleteBusy
										? t("editor.deleting")
										: `${t("editor.deleteRow")}${selectionCount ? ` (${selectionCount})` : ""}`}
								</button>
							) : null}
							<button type="button" onClick={runAndClose(onCopy)} className={`${menuItemClass} justify-between`}>
								<span>Copy TSV</span>
								<span className="text-[10px] text-muted-foreground">Excel / Sheets</span>
							</button>
							{onCopyMarkdown ? (
								<button type="button" onClick={runAndClose(onCopyMarkdown)} className={menuItemClass}>
									Copy as Markdown
								</button>
							) : null}
							{onCopySqlInsert ? (
								<button type="button" onClick={runAndClose(onCopySqlInsert)} className={menuItemClass}>
									Copy as SQL INSERT
								</button>
							) : null}
							{onToggleInspector ? (
								<button type="button" onClick={runAndClose(onToggleInspector)} className={`${menuItemClass} gap-2`}>
									<SidebarSimpleIcon className="size-3" />
									{t("editor.inspector", "Inspector")}
								</button>
							) : null}
							<div className="mt-1 border-t border-border pt-1">
								<div className="flex items-center justify-between px-2 py-1">
									<span className="text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
										{t("editor.columns")}
									</span>
									{hasHiddenColumns ? (
										<button
											type="button"
											className="text-[11px] text-muted-foreground hover:text-foreground"
											onClick={() => {
												for (const column of hideableColumns) {
													if (!column.visible) onToggleColumn(column.id, true);
												}
											}}
										>
											{t("editor.showAllColumns")}
										</button>
									) : null}
								</div>
								<div className="max-h-56 overflow-y-auto">
									{hideableColumns.map((column) => (
										<label
											key={column.id}
											className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-xs text-foreground hover:bg-muted"
										>
											<input
												type="checkbox"
												className="size-3.5 shrink-0 cursor-pointer"
												checked={column.visible}
												onChange={(event) =>
													onToggleColumn(column.id, event.target.checked)
												}
											/>
											<span className="min-w-0 truncate">{column.label}</span>
										</label>
									))}
								</div>
							</div>
						</PopoverContent>
					</Popover>

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
