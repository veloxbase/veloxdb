import {
  AlignBottomIcon, AlignLeftIcon, AlignRightIcon, AlignTopIcon,
  ArrowsClockwiseIcon, ArrowsInSimpleIcon, ArrowsOutIcon,
  DownloadSimpleIcon, FilePdfIcon, GridFourIcon, MagnetIcon,
  PlusIcon, SquaresFourIcon, TreeStructureIcon,
} from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';

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
  onExportPng: () => void;
  onExportPdf: () => void;
  // for switch between diagram and catalog
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
  onAddGroup, onCreateTable, onExportPng, onExportPdf,
}: DiagramToolbarProps) {
  const { t } = useTranslation();

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-border px-2 py-1.5">
      <span className="hidden text-[10px] font-medium text-muted-foreground sm:inline">{t('model.align')}</span>
      <Button type="button" variant="outline" size="icon" className="size-8" title={t('model.alignLeft')} disabled={selectedKeysCount < 2} onClick={onAlignLeft}>
        <AlignLeftIcon className="size-4" aria-hidden />
      </Button>
      <Button type="button" variant="outline" size="icon" className="size-8" title={t('model.alignRight')} disabled={selectedKeysCount < 2} onClick={onAlignRight}>
        <AlignRightIcon className="size-4" aria-hidden />
      </Button>
      <Button type="button" variant="outline" size="icon" className="size-8" title={t('model.alignTop')} disabled={selectedKeysCount < 2} onClick={onAlignTop}>
        <AlignTopIcon className="size-4" aria-hidden />
      </Button>
      <Button type="button" variant="outline" size="icon" className="size-8" title={t('model.alignBottom')} disabled={selectedKeysCount < 2} onClick={onAlignBottom}>
        <AlignBottomIcon className="size-4" aria-hidden />
      </Button>

      <div className="mx-1 hidden h-5 w-px bg-border sm:block" />

      <span className="hidden text-[10px] font-medium text-muted-foreground sm:inline">{t('model.views')}</span>
      <label className="sr-only" htmlFor="diagram-view-select">{t('model.diagramView')}</label>
      <select id="diagram-view-select" className="h-8 max-w-[9rem] rounded-md border border-input bg-background px-2 text-xs" value={activeViewId} onChange={(e) => onViewChange(e.target.value)}>
        {viewsRegistry.views.map((v) => (
          <option key={v.id} value={v.id}>{v.name}</option>
        ))}
      </select>
      <Button type="button" variant="outline" size="icon" className="size-8 shrink-0" title={t('model.newView')} onClick={onNewView}>
        <PlusIcon className="size-4" aria-hidden />
      </Button>
      {viewsRegistry.views.length > 1 && activeViewId !== 'default' ? (
        <Button type="button" variant="outline" size="icon" className="size-8 shrink-0" title={t('model.deleteView')} onClick={onDeleteView}>
          <DownloadSimpleIcon className="size-4" aria-hidden />
        </Button>
      ) : null}

      <div className="mx-1 hidden h-5 w-px bg-border sm:block" />

      <select className="h-8 rounded-md border border-input bg-background px-2 text-xs" value={columnDetail} onChange={(e) => onColumnDetailChange(e.target.value)}>
        <option value="full">{t('model.allCols')}</option>
        <option value="keys">{t('model.fkCols')}</option>
        <option value="header">{t('model.headers')}</option>
      </select>

      <div className="mx-1 hidden h-5 w-px bg-border sm:block" />

      <Button type="button" variant="outline" size="icon" className="size-8" title={t('model.undo')} disabled={!canUndo} onClick={onUndo}>
        <ArrowsClockwiseIcon className="size-4 rotate-180" aria-hidden />
      </Button>
      <Button type="button" variant="outline" size="icon" className="size-8" title={t('model.redo')} disabled={!canRedo} onClick={onRedo}>
        <ArrowsClockwiseIcon className="size-4" aria-hidden />
      </Button>

      <div className="mx-1 hidden h-5 w-px bg-border sm:block" />

      <Button type="button" variant={snapToGrid ? 'default' : 'outline'} size="icon" className="size-8" title={t('model.snapToGrid')} onClick={onToggleSnap}>
        <MagnetIcon className="size-4" aria-hidden />
      </Button>

      <Button type="button" variant="outline" size="icon" className="size-8" title={t('model.autoLayoutGrid')} onClick={onAutoLayoutGrid}>
        <GridFourIcon className="size-4" aria-hidden />
      </Button>
      <Button type="button" variant="outline" size="icon" className="size-8" title={t('model.autoLayoutTopo')} onClick={onAutoLayoutTopo}>
        <TreeStructureIcon className="size-4" aria-hidden />
      </Button>
      <Button type="button" variant="outline" size="icon" className="size-8" title={t('model.autoLayoutDagre')} onClick={onAutoLayoutDagre}>
        <SquaresFourIcon className="size-4" aria-hidden />
      </Button>

      <div className="mx-1 hidden h-5 w-px bg-border sm:block" />

      <Button type="button" variant="outline" size="icon" className="size-8" title={t('model.fitSelection')} disabled={selectedKeysCount === 0} onClick={onFitSelection}>
        <ArrowsOutIcon className="size-4" aria-hidden />
      </Button>
      <Button type="button" variant="outline" size="icon" className="size-8" title={t('model.resetView')} onClick={onResetViewport}>
        <ArrowsInSimpleIcon className="size-4" aria-hidden />
      </Button>
      <Button type="button" variant="outline" size="icon" className="size-8" title={t('model.resetLayout')} onClick={onResetLayout}>
        <ArrowsClockwiseIcon className="size-4" aria-hidden />
      </Button>

      <div className="mx-1 hidden h-5 w-px bg-border sm:block" />

      <Button type="button" variant="outline" size="icon" className="size-8" title={t('model.groupSelection')} disabled={selectedKeysCount < 2} onClick={onAddGroup}>
        <PlusIcon className="size-4" aria-hidden />
      </Button>
      <Button type="button" variant="outline" size="sm" className="h-8 text-xs" onClick={onCreateTable}>
        <PlusIcon className="mr-1 size-3.5" aria-hidden />{t('model.createTable')}
      </Button>
      <Button type="button" variant="outline" size="icon" className="size-8" title="Export PNG" onClick={onExportPng}>
        <DownloadSimpleIcon className="size-4" aria-hidden />
      </Button>
      <Button type="button" variant="outline" size="icon" className="size-8" title="Export PDF" onClick={onExportPdf}>
        <FilePdfIcon className="size-4" aria-hidden />
      </Button>
    </div>
  );
}
