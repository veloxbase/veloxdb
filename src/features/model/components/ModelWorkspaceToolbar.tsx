import {
  ArrowsClockwiseIcon, ArrowsOutIcon,
  CopyIcon, DotsThreeIcon, PlusIcon,
} from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

type DiagramToolbarProps = {
  activeViewId: string;
  viewsRegistry: { views: { id: string; name: string }[] };
  onViewChange: (id: string) => void;
  onNewView: () => void;
  onDeleteView: () => void;
  columnDetail: string;
  onColumnDetailChange: (v: string) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  snapToGrid: boolean;
  onToggleSnap: () => void;
  selectedKeysCount: number;
  onAlignLeft: () => void;
  onAlignRight: () => void;
  onAlignTop: () => void;
  onAlignBottom: () => void;
  onAutoLayoutGrid: () => void;
  onAutoLayoutTopo: () => void;
  onAutoLayoutDagre: () => void;
  onFitSelection: () => void;
  onResetViewport: () => void;
  onResetLayout: () => void;
  onAddGroup: () => void;
  onCreateTable: () => void;
  onCopySelectedSql: () => void;
  onCopyAllTablesSql: () => void;
  copySqlPending?: boolean;
  onExportPng: () => void;
  onExportPdf: () => void;
  onSwitchTab: (tab: 'diagram' | 'catalog') => void;
};

export function ModelWorkspaceToolbar({
  activeViewId, viewsRegistry, onViewChange, onNewView, onDeleteView,
  columnDetail, onColumnDetailChange,
  canUndo, canRedo, onUndo, onRedo,
  snapToGrid, onToggleSnap,
  selectedKeysCount, onAlignLeft, onAlignRight, onAlignTop, onAlignBottom,
  onAutoLayoutGrid, onAutoLayoutTopo, onAutoLayoutDagre,
  onFitSelection, onResetViewport, onResetLayout,
  onAddGroup, onCreateTable, onCopySelectedSql, onCopyAllTablesSql, copySqlPending = false,
  onExportPng, onExportPdf,
}: DiagramToolbarProps) {
  const { t } = useTranslation();

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-border px-2 py-1.5">
      <Button type="button" variant="outline" size="icon" className="size-8" title={t('model.undo')} disabled={!canUndo} onClick={onUndo}>
        <ArrowsClockwiseIcon className="size-4 rotate-180" aria-hidden />
      </Button>
      <Button type="button" variant="outline" size="icon" className="size-8" title={t('model.redo')} disabled={!canRedo} onClick={onRedo}>
        <ArrowsClockwiseIcon className="size-4" aria-hidden />
      </Button>
      <Button type="button" variant="outline" size="icon" className="size-8" title={t('model.fitSelection')} disabled={selectedKeysCount === 0} onClick={onFitSelection}>
        <ArrowsOutIcon className="size-4" aria-hidden />
      </Button>
      <Button type="button" variant="outline" size="sm" className="h-8 text-xs" onClick={onCreateTable}>
        <PlusIcon className="mr-1 size-3.5" aria-hidden />{t('model.createTable')}
      </Button>
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="size-8"
        title={t('model.copySelectedTablesSql')}
        disabled={selectedKeysCount === 0 || copySqlPending}
        onClick={onCopySelectedSql}
      >
        <CopyIcon className="size-4" aria-hidden />
      </Button>
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="size-8"
        title={t('model.copyAllTablesSql')}
        disabled={copySqlPending}
        onClick={onCopyAllTablesSql}
      >
        <CopyIcon className="size-4" weight="fill" aria-hidden />
      </Button>

      <Popover>
        <PopoverTrigger asChild>
          <Button type="button" variant="ghost" size="icon" className="size-8" title={t('editor.moreActions')}>
            <DotsThreeIcon className="size-4" aria-hidden />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-56 p-1">
          <div className="px-2 py-1 text-[10px] uppercase tracking-wide text-muted-foreground">{t('model.views')}</div>
          <select id="diagram-view-select" className="mb-1 h-8 w-full rounded-md border border-input bg-background px-2 text-xs" value={activeViewId} onChange={(e) => onViewChange(e.target.value)}>
            {viewsRegistry.views.map((v) => (
              <option key={v.id} value={v.id}>{v.name}</option>
            ))}
          </select>
          <button type="button" className="flex w-full rounded-md px-2 py-1.5 text-left text-xs hover:bg-accent" onClick={onNewView}>{t('model.newView')}</button>
          {viewsRegistry.views.length > 1 && activeViewId !== 'default' ? (
            <button type="button" className="flex w-full rounded-md px-2 py-1.5 text-left text-xs hover:bg-accent" onClick={onDeleteView}>{t('model.deleteView')}</button>
          ) : null}

          <select className="my-1 h-8 w-full rounded-md border border-input bg-background px-2 text-xs" value={columnDetail} onChange={(e) => onColumnDetailChange(e.target.value)}>
            <option value="full">{t('model.allCols')}</option>
            <option value="keys">{t('model.fkCols')}</option>
            <option value="header">{t('model.headers')}</option>
          </select>

          <button type="button" className="flex w-full rounded-md px-2 py-1.5 text-left text-xs hover:bg-accent disabled:opacity-50" disabled={selectedKeysCount < 2} onClick={onAlignLeft}>{t('model.alignLeft')}</button>
          <button type="button" className="flex w-full rounded-md px-2 py-1.5 text-left text-xs hover:bg-accent disabled:opacity-50" disabled={selectedKeysCount < 2} onClick={onAlignRight}>{t('model.alignRight')}</button>
          <button type="button" className="flex w-full rounded-md px-2 py-1.5 text-left text-xs hover:bg-accent disabled:opacity-50" disabled={selectedKeysCount < 2} onClick={onAlignTop}>{t('model.alignTop')}</button>
          <button type="button" className="flex w-full rounded-md px-2 py-1.5 text-left text-xs hover:bg-accent disabled:opacity-50" disabled={selectedKeysCount < 2} onClick={onAlignBottom}>{t('model.alignBottom')}</button>

          <button type="button" className="flex w-full rounded-md px-2 py-1.5 text-left text-xs hover:bg-accent" onClick={onToggleSnap}>
            {t('model.snapToGrid')}{snapToGrid ? ' · on' : ''}
          </button>
          <button type="button" className="flex w-full rounded-md px-2 py-1.5 text-left text-xs hover:bg-accent" onClick={onAutoLayoutGrid}>{t('model.autoLayoutGrid')}</button>
          <button type="button" className="flex w-full rounded-md px-2 py-1.5 text-left text-xs hover:bg-accent" onClick={onAutoLayoutTopo}>{t('model.autoLayoutTopo')}</button>
          <button type="button" className="flex w-full rounded-md px-2 py-1.5 text-left text-xs hover:bg-accent" onClick={onAutoLayoutDagre}>{t('model.autoLayoutDagre')}</button>
          <button type="button" className="flex w-full rounded-md px-2 py-1.5 text-left text-xs hover:bg-accent" onClick={onResetViewport}>{t('model.resetView')}</button>
          <button type="button" className="flex w-full rounded-md px-2 py-1.5 text-left text-xs hover:bg-accent" onClick={onResetLayout}>{t('model.resetLayout')}</button>
          <button type="button" className="flex w-full rounded-md px-2 py-1.5 text-left text-xs hover:bg-accent disabled:opacity-50" disabled={selectedKeysCount < 2} onClick={onAddGroup}>{t('model.groupSelection')}</button>
          <button type="button" className="flex w-full rounded-md px-2 py-1.5 text-left text-xs hover:bg-accent" onClick={onExportPng}>Export PNG</button>
          <button type="button" className="flex w-full rounded-md px-2 py-1.5 text-left text-xs hover:bg-accent" onClick={onExportPdf}>Export PDF</button>
        </PopoverContent>
      </Popover>
    </div>
  );
}
