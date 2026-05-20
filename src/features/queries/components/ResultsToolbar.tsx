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

	return (
		<div className="min-w-0 overflow-x-auto border-b border-border bg-muted/20 px-3 py-2">
			<div className="flex min-w-full w-max items-center justify-between gap-3">
				<div className="flex shrink-0 items-center gap-2">
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

				<div className="flex shrink-0 items-center gap-2">
					<details className="relative shrink-0">
						<summary className="list-none">
							<Button variant="outline" size="xs" asChild>
								<span>{t("editor.columns")}</span>
							</Button>
						</summary>
						<div className="absolute right-0 z-10 mt-1 min-w-44 border border-border bg-background p-2 shadow-sm">
							<div className="mb-2 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
								{t("editor.visibility")}
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
