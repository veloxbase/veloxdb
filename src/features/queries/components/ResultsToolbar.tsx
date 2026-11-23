import { CaretDownIcon } from "@phosphor-icons/react";
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
};

export function ResultsToolbar({
	columns,
	canEdit,
	isDirty,
	isBusy,
	onToggleColumn,
	onRefresh,
	onCopy,
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
}: ResultsToolbarProps) {
	const { t } = useTranslation();
	const hideableColumns = columns.filter((column) => column.canHide);
	const visibleHideableCount = hideableColumns.filter(
		(column) => column.visible,
	).length;
	const hasHiddenColumns = visibleHideableCount < hideableColumns.length;

	return (
		<div className="min-w-0 shrink-0 border-b border-border bg-muted/20 px-3 py-1.5">
			<div className="flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
				<div className="flex min-w-0 flex-wrap items-center gap-1.5">
					{onAddRow ? (
						<Button
							variant="outline"
							size="xs"
							onClick={onAddRow}
							disabled={isBusy}
						>
							{t("editor.insertRow")}
						</Button>
					) : null}
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
          {onDeleteRows ? (
            <Button
              variant="outline"
              size="xs"
              onClick={onDeleteRows}
              disabled={isBusy || deleteBusy || selectionCount === 0}
              title={deleteDisabledReason}
              className="text-destructive hover:bg-destructive/10"
            >
              {deleteBusy ? t("editor.deleting") : `${t("editor.deleteRow")}${selectionCount ? ` (${selectionCount})` : ""}`}
            </Button>
          ) : null}
          <Button
            variant="outline"
            size="xs"
            onClick={onRefresh}
            disabled={isBusy}
          >
            {t("editor.refresh")}
          </Button>
					<Button variant="outline" size="xs" onClick={onCopy}>
						{t("editor.copy")}
					</Button>
					<Button variant="outline" size="xs" onClick={onDownloadCsv}>
						{t("editor.exportCsv")}
					</Button>
					<Button variant="outline" size="xs" onClick={onDownloadJson}>
						{t("editor.exportJson")}
					</Button>
				</div>

				<div className="flex shrink-0 items-center gap-1.5">
					<Popover>
						<PopoverTrigger asChild>
							<Button variant="outline" size="xs">
								{t("editor.columns")}
								{hasHiddenColumns ? (
									<span className="tabular-nums text-muted-foreground">
										{visibleHideableCount}/{hideableColumns.length}
									</span>
								) : null}
								<CaretDownIcon className="text-muted-foreground" />
							</Button>
						</PopoverTrigger>
						<PopoverContent align="end" className="w-60 p-0">
							<div className="flex items-center justify-between border-b border-border px-3 py-2">
								<span className="text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
									{t("editor.visibility")}
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
							<div className="max-h-64 overflow-y-auto p-1">
								{hideableColumns.map((column) => (
									<label
										key={column.id}
										className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-xs text-foreground hover:bg-muted/60"
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
