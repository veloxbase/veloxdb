import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { queryKeys } from '@/data/query-keys';
import type { DatabaseEngine, TableInfo } from '@/data/types';
import { applyEntireModel } from '@/features/model/apply-entire-model';
import { CreateTableDialog } from '@/features/model/components/CreateTableDialog';
import { DdlReviewDialog } from '@/features/model/components/DdlReviewDialog';
import { DiagramSurfaceAdapter } from '@/features/model/components/DiagramSurfaceAdapter';
import { ModelCatalog } from '@/features/model/components/ModelCatalog';
import { ModelInspector } from '@/features/model/components/ModelInspector';
import { ModelWorkspaceToolbar } from '@/features/model/components/ModelWorkspaceToolbar';
import { MigrationPreviewDialog } from '@/features/model/components/MigrationPreviewDialog';
import { defaultDiagramHeaderHex as distinctDiagramHeaderHex } from '@/features/model/diagram-header-palette';
import { readDiagramPalette } from '@/features/model/diagram-theme';
import { useModelColumns } from '@/features/model/hooks/useModelColumns';
import { useModelInitialization } from '@/features/model/hooks/useModelInitialization';
import { useModelWorkspaceStore } from '@/features/model/hooks/useModelWorkspaceStore';
import {
	deleteDiagramViewLayout, duplicateLayoutSnapshotForNewView,
	ensurePositions, gridPositionForIndex,
	loadDiagramLayout, loadDiagramViewsRegistry,
	saveDiagramLayout, saveDiagramViewsRegistry,
} from '@/features/model/model-layout-storage';
import {
	DEFAULT_DIAGRAM_VIEW_ID, tableKey,
	type TableKey,
} from '@/features/model/model-types';
import { useForeignKeysQuery } from '@/features/model/queries';
import { canQueueRelationship } from '@/features/model/relationship-validation';
import { rgbCssToHex } from '@/lib/contrast-text-for-bg';

type ModelWorkspaceProps = {
	connectionId: string;
	connectionEngine: DatabaseEngine;
	defaultDatabaseName: string;
	isDark: boolean;
	tables: TableInfo[];
	tablesErrorMessage?: string;
	isTablesLoading: boolean;
	selectedTable: TableInfo | null;
};

const LOAD_ALL_CONFIRM_THRESHOLD = 150;

export function ModelWorkspace({
	connectionId, connectionEngine, defaultDatabaseName,
	isDark, tables, tablesErrorMessage, isTablesLoading, selectedTable,
}: ModelWorkspaceProps) {
	const { t } = useTranslation();
	const queryClient = useQueryClient();
	const foreignKeysQuery = useForeignKeysQuery(connectionId);

	// Layout boot
	const boot = useMemo(() => {
		const vr = loadDiagramViewsRegistry(connectionId);
		const aid = vr.activeViewId;
		const snap = loadDiagramLayout(connectionId, aid);
		return { vr, aid, snap };
	}, [connectionId]);

	const diagramWrapRef = useRef<HTMLDivElement>(null);
	const hadStoredLayout = boot.snap != null && (boot.snap.onCanvas.length > 0 || Object.keys(boot.snap.positions).length > 0);

	const store = useModelWorkspaceStore();

	// Hydrate
	useEffect(() => {
		store.hydrateFromConnection({ connectionId, defaultDatabaseName });
	}, [connectionId, defaultDatabaseName, store.hydrateFromConnection]);

	// Local state
	const [ddlOpen, setDdlOpen] = useState(false);
	const [createTableOpen, setCreateTableOpen] = useState(false);
	const [migrationPreviewOpen, setMigrationPreviewOpen] = useState(false);
	const [applyPending, setApplyPending] = useState(false);
	const [applyError, setApplyError] = useState<string | null>(null);
	const [initialSeedReason, setInitialSeedReason] = useState<null | 'relationships' | 'sample'>(null);

	// Initialization effects
	const init = useModelInitialization({
		connectionId, tables,
		onCanvas: store.onCanvas,
		hadStoredLayout,
		setOnCanvas: store.setOnCanvas,
		setPositions: store.setPositions,
		selectSingleFromCatalog: store.selectSingleFromCatalog,
		setInitialSeedReason,
		selectedTable,
		primaryKey: store.primaryKey,
		setIdentityDraftByKey: store.setIdentityDraftByKey,
	});
	const { tablesByKey } = init;

	// Undo/redo shortcut
	useEffect(() => {
		const ignoredTags = new Set(['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON']);
		const onKeyDown = (e: KeyboardEvent) => {
			const target = e.target as HTMLElement | null;
			if (target?.isContentEditable || (target && ignoredTags.has(target.tagName))) return;
			const mod = e.metaKey || e.ctrlKey;
			if (!mod || e.altKey) return;
			if (e.key.toLowerCase() !== 'z') return;
			e.preventDefault();
			if (e.shiftKey) store.redo(); else store.undo();
		};
		window.addEventListener('keydown', onKeyDown);
		return () => window.removeEventListener('keydown', onKeyDown);
	}, [store.redo, store.undo]);

	// Column management
	const col = useModelColumns({
		connectionId, tables,
		onCanvas: store.onCanvas,
		columnDetail: store.columnDetail,
		foreignKeys: foreignKeysQuery.data ?? [],
		pendingForeignKeys: store.pendingForeignKeys,
		columnIdentityOverridesByKey: store.columnIdentityOverridesByKey,
		pendingAddColumnsByKey: store.pendingAddColumnsByKey,
	});

	// Layout persistence
	useEffect(() => {
		if (!store.hydrated) return;
		if (store.storeConnectionId !== connectionId) return;
		const t = window.setTimeout(() => {
			saveDiagramLayout(connectionId, {
				onCanvas: store.onCanvas, positions: store.positions, viewport: store.viewport,
				modelTitle: store.modelTitle.trim() || defaultDatabaseName,
				diagramTool: store.diagramTool, snapToGrid: store.snapToGrid, columnDetail: store.columnDetail,
				...(store.diagramGroups.length > 0 ? { diagramGroups: store.diagramGroups } : {}),
				...(Object.keys(store.headerColorsByKey).length > 0 ? { headerColors: store.headerColorsByKey } : {}),
			}, store.activeViewId);
			saveDiagramViewsRegistry(connectionId, store.viewsRegistry);
		}, 400);
		return () => window.clearTimeout(t);
	}, [store.hydrated, store.activeViewId, store.columnDetail, connectionId, defaultDatabaseName,
		store.diagramGroups, store.diagramTool, store.headerColorsByKey, store.modelTitle,
		store.onCanvas, store.positions, store.snapToGrid, store.storeConnectionId,
		store.viewsRegistry, store.viewport]);

	// Derived values
	const diagramPalette = useMemo(() => readDiagramPalette(isDark), [isDark]);

	const tablesOnCanvas = useMemo(() => {
		const list: TableInfo[] = [];
		for (const k of store.onCanvas) { const t = tablesByKey.get(k); if (t) list.push(t); }
		return list;
	}, [store.onCanvas, tablesByKey]);
	const totalTableCount = tables.length;
	const onDiagramCount = tablesOnCanvas.length;
	const isPartialDiagram = totalTableCount - onDiagramCount > 0;
	const showInitialSeedHint = initialSeedReason != null && isPartialDiagram;

	const tableDisplays = useMemo(() => tablesOnCanvas.map((t) => {
		const k = tableKey(t);
		const id = store.identityDraftByKey[k];
		return { key: k, schema: id?.schema ?? t.schema, name: id?.name ?? t.name };
	}), [tablesOnCanvas, store.identityDraftByKey]);

	const resolvedHeaderColors = useMemo(() => {
		const out: Record<TableKey, string> = {};
		for (const d of tableDisplays) out[d.key] = store.headerColorsByKey[d.key] ?? distinctDiagramHeaderHex(d.key, isDark);
		return out;
	}, [tableDisplays, store.headerColorsByKey, isDark]);

	const inspectorTable = useMemo(() => {
		if (!store.primaryKey) return null;
		return tablesByKey.get(store.primaryKey) ?? null;
	}, [store.primaryKey, tablesByKey]);

	const isModelDirty = useMemo(() => {
		if (store.pendingForeignKeys.length > 0) return true;
		if (store.pendingCreateTables.length > 0) return true;
		for (const k of store.onCanvas) {
			const t = tablesByKey.get(k);
			if (!t) continue;
			const id = store.identityDraftByKey[k];
			if (id && (id.schema !== t.schema || id.name !== t.name)) return true;
			const co = store.columnOverridesByKey[k];
			if (co && Object.keys(co).length > 0) return true;
			const cio = store.columnIdentityOverridesByKey[k];
			if (cio && Object.keys(cio).length > 0) return true;
			const adds = store.pendingAddColumnsByKey[k];
			if (adds && adds.length > 0) return true;
		}
		if (store.pendingRules.length > 0 || store.pendingTriggers.length > 0 || store.pendingRlsPolicies.length > 0) return true;
		return false;
	}, [store.onCanvas, tablesByKey, store.identityDraftByKey, store.columnOverridesByKey,
		store.columnIdentityOverridesByKey, store.pendingAddColumnsByKey, store.pendingForeignKeys,
		store.pendingCreateTables, store.pendingRules.length, store.pendingTriggers.length, store.pendingRlsPolicies.length]);

	const catalogTablesSorted = useMemo(() => [...tables].sort((a, b) => tableKey(a).localeCompare(tableKey(b))), [tables]);

	// Canvas ops
	const requestColumns = useCallback((key: TableKey) => { col.requestColumns(key); }, [col.requestColumns]);

	const snapIf = useCallback(
		(p: { x: number; y: number }) => store.snapToGrid
			? { x: Math.round(p.x / 20) * 20, y: Math.round(p.y / 20) * 20 }
			: p,
		[store.snapToGrid],
	);

	const positionsRef = useRef(store.positions);
	const selectedKeysRef = useRef(store.selectedKeys);

	useEffect(() => { positionsRef.current = store.positions; }, [store.positions]);
	useEffect(() => { selectedKeysRef.current = store.selectedKeys; }, [store.selectedKeys]);

	const applyTableDragPositions = useCallback((key: TableKey, x: number, y: number) => {
		store.setPositions((prev) => ({ ...prev, [key]: snapIf({ x, y }) }));
	}, [snapIf, store.setPositions]);

	const handleAutoLayoutGrid = useCallback(() => {
		store.setPositions((prev) => {
			const next = { ...prev };
			store.onCanvas.forEach((k, i) => { next[k] = gridPositionForIndex(i); });
			return next;
		});
	}, [store.onCanvas, store.setPositions]);

	const handleAddToCanvas = useCallback((table: TableInfo) => {
		const k = tableKey(table);
		store.setOnCanvas((prev) => (prev.includes(k) ? prev : [...prev, k]));
		store.setPositions((p) => ensurePositions([k], p));
		store.setIdentityDraftByKey((prev) => (prev[k] != null ? prev : { ...prev, [k]: { schema: table.schema, name: table.name } }));
		requestColumns(k);
		store.setModelTab('diagram');
	}, [requestColumns, store.setModelTab]);

	const handleRemoveFromCanvas = useCallback((table: TableInfo) => {
		const k = tableKey(table);
		store.setOnCanvas((prev) => prev.filter((x) => x !== k));
		store.setSelectedKeys((prev) => prev.filter((x) => x !== k));
		store.setIdentityDraftByKey((prev) => { const next = { ...prev }; delete next[k]; return next; });
		store.setColumnOverridesByKey((prev) => { const next = { ...prev }; delete next[k]; return next; });
		store.setColumnIdentityOverridesByKey((prev) => { const next = { ...prev }; delete next[k]; return next; });
		store.setPendingAddColumnsByKey((prev) => { const next = { ...prev }; delete next[k]; return next; });
		store.setPendingForeignKeys((prev) => prev.filter((fk) => fk.fromKey !== k && fk.toKey !== k));
		store.setSelectedEdge((prev) => (prev && (prev.fromKey === k || prev.toKey === k) ? null : prev));
		store.setHeaderColorsByKey((prev) => { if (prev[k] == null) return prev; const next = { ...prev }; delete next[k]; return next; });
	}, []);

	const canQueueForeignKey = useCallback(
		(input: { fromKey: TableKey; fromColumn: string; toKey: TableKey; toColumn: string }) =>
			canQueueRelationship(input, foreignKeysQuery.data ?? [], store.pendingForeignKeys),
		[foreignKeysQuery.data, store.pendingForeignKeys],
	);

	const handleConnectColumns = useCallback(
		(fromKey: TableKey, fromColumn: string, toKey: TableKey, toColumn: string) => {
			if (!canQueueForeignKey({ fromKey, fromColumn, toKey, toColumn })) return;
			requestColumns(fromKey); requestColumns(toKey);
			store.setPendingForeignKeys((prev) => [...prev, { id: crypto.randomUUID(), fromKey, fromColumn, toKey, toColumn }]);
		}, [canQueueForeignKey, requestColumns, store.setPendingForeignKeys],
	);

	const handleLoadAllTables = useCallback(() => {
		if (!isPartialDiagram) return;
		if (totalTableCount >= LOAD_ALL_CONFIRM_THRESHOLD &&
			!window.confirm(t('model.loadAllConfirm', { count: totalTableCount }))) return;
		const keys = tables.map((table) => tableKey(table));
		store.setOnCanvas((prev) => { const next = new Set(prev); for (const k of keys) next.add(k); if (next.size === prev.length) return prev; return [...next]; });
		store.setPositions((prev) => ensurePositions(keys, prev));
		keys.forEach((k) => requestColumns(k));
	}, [isPartialDiagram, tables, totalTableCount, requestColumns, t]);

	// Diagram view management
	const handleDiagramViewChange = useCallback((nextId: string) => {
		if (nextId === store.activeViewId) return;
		saveDiagramLayout(connectionId, {
			onCanvas: store.onCanvas, positions: store.positions, viewport: store.viewport,
			modelTitle: store.modelTitle.trim() || defaultDatabaseName,
			diagramTool: store.diagramTool, snapToGrid: store.snapToGrid, columnDetail: store.columnDetail,
			...(store.diagramGroups.length > 0 ? { diagramGroups: store.diagramGroups } : {}),
			...(Object.keys(store.headerColorsByKey).length > 0 ? { headerColors: store.headerColorsByKey } : {}),
		}, store.activeViewId);
		const nextReg = { ...store.viewsRegistry, activeViewId: nextId };
		saveDiagramViewsRegistry(connectionId, nextReg);
		store.setViewsRegistry(nextReg);
		const snap = loadDiagramLayout(connectionId, nextId);
		if (snap) {
			store.setSnapToGrid(snap.snapToGrid !== false);
			store.setOnCanvas([...snap.onCanvas]);
			store.setPositions({ ...snap.positions });
			store.setViewport({ ...snap.viewport });
			store.setModelTitle(snap.modelTitle?.trim() || defaultDatabaseName);
			store.setHeaderColorsByKey({ ...(snap.headerColors ?? {}) });
			if (snap.diagramTool === 'pan' || snap.diagramTool === 'connect' || snap.diagramTool === 'select') store.setDiagramTool(snap.diagramTool);
			const cd = snap.columnDetail;
			store.setColumnDetail(cd === 'keys' || cd === 'header' ? cd : 'full');
			store.setDiagramGroups(snap.diagramGroups ?? []);
		}
	}, [connectionId, defaultDatabaseName, store.activeViewId, store.columnDetail, store.diagramGroups,
		store.diagramTool, store.headerColorsByKey, store.modelTitle, store.onCanvas, store.positions,
		store.snapToGrid, store.viewsRegistry, store.viewport]);

	const handleNewDiagramView = useCallback(() => {
		const id = crypto.randomUUID();
		const name = `View ${store.viewsRegistry.views.length + 1}`;
		duplicateLayoutSnapshotForNewView(connectionId, store.activeViewId, id, {
			onCanvas: store.onCanvas, positions: store.positions, viewport: store.viewport,
			modelTitle: store.modelTitle.trim() || defaultDatabaseName,
			diagramTool: store.diagramTool, snapToGrid: store.snapToGrid, columnDetail: store.columnDetail,
			...(store.diagramGroups.length > 0 ? { diagramGroups: store.diagramGroups } : {}),
			...(Object.keys(store.headerColorsByKey).length > 0 ? { headerColors: store.headerColorsByKey } : {}),
		});
		const nextReg = { activeViewId: id, views: [...store.viewsRegistry.views, { id, name }] };
		saveDiagramViewsRegistry(connectionId, nextReg);
		store.setViewsRegistry(nextReg);
	}, [connectionId, defaultDatabaseName, store.activeViewId, store.columnDetail, store.diagramGroups,
		store.diagramTool, store.headerColorsByKey, store.modelTitle, store.onCanvas, store.positions,
		store.snapToGrid, store.viewsRegistry.views, store.viewport]);

	const handleDeleteDiagramView = useCallback(() => {
		if (store.activeViewId === DEFAULT_DIAGRAM_VIEW_ID) return;
		if (store.viewsRegistry.views.length < 2) return;
		deleteDiagramViewLayout(connectionId, store.activeViewId);
		const remaining = store.viewsRegistry.views.filter((v) => v.id !== store.activeViewId);
		const nextId = remaining[0]?.id ?? DEFAULT_DIAGRAM_VIEW_ID;
		const nextReg = { activeViewId: nextId, views: remaining };
		saveDiagramViewsRegistry(connectionId, nextReg);
		store.setViewsRegistry(nextReg);
		const snap = loadDiagramLayout(connectionId, nextId);
		if (snap) {
			store.setSnapToGrid(snap.snapToGrid !== false);
			store.setOnCanvas([...snap.onCanvas]);
			store.setPositions({ ...snap.positions });
			store.setViewport({ ...snap.viewport });
			store.setModelTitle(snap.modelTitle?.trim() || defaultDatabaseName);
			store.setHeaderColorsByKey({ ...(snap.headerColors ?? {}) });
			if (snap.diagramTool === 'pan' || snap.diagramTool === 'connect' || snap.diagramTool === 'select') store.setDiagramTool(snap.diagramTool);
			const cd = snap.columnDetail;
			store.setColumnDetail(cd === 'keys' || cd === 'header' ? cd : 'full');
			store.setDiagramGroups(snap.diagramGroups ?? []);
		}
	}, [connectionId, defaultDatabaseName, store.activeViewId, store.viewsRegistry.views]);

	const handleApplyEntireModel = useCallback(async () => {
		setApplyError(null); setApplyPending(true);
		try {
			const result = await applyEntireModel({
				connectionId, engine: connectionEngine,
				onCanvas: store.onCanvas, tablesByKey,
				identityDraftByKey: store.identityDraftByKey,
				columnOverridesByKey: store.columnOverridesByKey,
				columnIdentityOverridesByKey: store.columnIdentityOverridesByKey,
				pendingAddColumnsByKey: store.pendingAddColumnsByKey,
				pendingForeignKeys: store.pendingForeignKeys,
				pendingRules: store.pendingRules,
				pendingTriggers: store.pendingTriggers,
				pendingRlsPolicies: store.pendingRlsPolicies,
				pendingCreateTables: store.pendingCreateTables,
			});
			let nextOnCanvas = [...store.onCanvas];
			const nextPos = { ...store.positions };
			const nextHeaderColors = { ...store.headerColorsByKey };
			for (const { from, to } of result.renamed) {
				nextOnCanvas = nextOnCanvas.map((x) => (x === from ? to : x));
				if (nextPos[from]) { nextPos[to] = nextPos[from]; delete nextPos[from]; }
				if (nextHeaderColors[from]) { nextHeaderColors[to] = nextHeaderColors[from]; delete nextHeaderColors[from]; }
			}
			store.setOnCanvas(nextOnCanvas);
			store.setPositions(nextPos);
			store.setHeaderColorsByKey(nextHeaderColors);
			store.setIdentityDraftByKey({}); store.setColumnOverridesByKey({});
			store.setColumnIdentityOverridesByKey({}); store.setPendingAddColumnsByKey({});
			store.setPendingForeignKeys([]); store.setPendingRules([]);
			store.setPendingTriggers([]); store.setPendingRlsPolicies([]);
			store.setPendingCreateTables([]);
			const remapKey = (k: TableKey) => result.renamed.find((r) => r.from === k)?.to ?? k;
			const nextSelected = [...new Set(store.selectedKeys.map(remapKey))].filter((k) => nextOnCanvas.includes(k));
			let nextPrimary: TableKey | null = store.primaryKey;
			if (nextPrimary) { nextPrimary = remapKey(nextPrimary); if (!nextOnCanvas.includes(nextPrimary)) nextPrimary = nextSelected[0] ?? null; }
			else { nextPrimary = nextSelected[0] ?? null; }
			store.replaceSelection(nextSelected, nextPrimary);
			void queryClient.invalidateQueries({ queryKey: queryKeys.tables(connectionId) });
			void queryClient.invalidateQueries({ queryKey: queryKeys.foreignKeys(connectionId) });
			void queryClient.invalidateQueries({ queryKey: ['schema'] });
			void queryClient.invalidateQueries({ queryKey: ['tableProperties'] });
			void queryClient.invalidateQueries({ queryKey: ['tableIndexes'] });
		} catch (err) {
			setApplyError(err instanceof Error ? err.message : 'Failed to apply model');
		} finally { setApplyPending(false); }
	}, [connectionEngine, connectionId, queryClient, store.columnOverridesByKey, store.columnIdentityOverridesByKey,
		store.headerColorsByKey, store.identityDraftByKey, store.onCanvas, store.pendingAddColumnsByKey,
		store.pendingCreateTables, store.pendingForeignKeys, store.pendingRlsPolicies, store.pendingRules,
		store.pendingTriggers, store.positions, store.primaryKey, store.replaceSelection, store.selectedKeys, tablesByKey]);

	// Gurad returns
	if (isTablesLoading && !tables.length) {
		return <div className="flex flex-1 items-center justify-center text-xs text-muted-foreground">Loading tables…</div>;
	}
	if (tablesErrorMessage) {
		return <div className="flex flex-1 items-center justify-center px-4 text-center text-xs text-destructive">{tablesErrorMessage}</div>;
	}
	if (!isTablesLoading && tables.length === 0) {
		return (
			<div className="flex flex-1 items-center justify-center px-4">
				<div className="max-w-sm rounded-md border border-border/80 bg-background/90 px-5 py-4 text-center shadow-sm">
					<p className="text-sm font-medium text-foreground">{t('model.noTablesYet')}</p>
					<p className="mt-1.5 text-xs text-muted-foreground">This database has no tables.</p>
					<div className="mt-4 flex items-center justify-center gap-2">
						<Button type="button" variant="default" size="sm" className="text-xs" onClick={() => setCreateTableOpen(true)}>{t('model.createTable')}</Button>
						<Button type="button" variant="outline" size="sm" className="text-xs" onClick={() => setDdlOpen(true)}>{t('model.runDdlScript')}</Button>
					</div>
				</div>
			</div>
		);
	}

	return (
		<div className="flex h-full min-h-0 min-w-0 flex-col">
			<div className="flex shrink-0 flex-col gap-2 border-b border-border px-3 py-2 sm:flex-row sm:items-end sm:justify-between">
				<div className="flex min-w-0 flex-1 flex-col gap-1.5">
					<label className="text-[10px] font-medium text-muted-foreground" htmlFor="model-workspace-title">Model / database label</label>
					<Input id="model-workspace-title" className="h-8 max-w-sm text-xs" value={store.modelTitle} onChange={(e) => store.setModelTitle(e.target.value)} placeholder={defaultDatabaseName} spellCheck={false} />
					<div className="text-[11px] text-muted-foreground">
						{foreignKeysQuery.isLoading && 'Loading relationships…'}
						{foreignKeysQuery.isError && <span className="text-destructive">{foreignKeysQuery.error instanceof Error ? foreignKeysQuery.error.message : 'Failed to load foreign keys'}</span>}
						{applyError && <span className="mt-1 block text-destructive">{applyError}</span>}
					</div>
				</div>
				<div className="flex shrink-0 flex-wrap items-center gap-2">
					<Button type="button" size="sm" className="h-8 text-xs" disabled={!isModelDirty} onClick={() => setMigrationPreviewOpen(true)}>{t('model.reviewAndApply')}</Button>
					<Button type="button" variant="outline" size="sm" className="h-8 text-xs" disabled={!isModelDirty} onClick={() => {}}>
						{t('model.downloadSql')}
					</Button>
					<Button type="button" variant="outline" size="sm" className="h-8 text-xs" onClick={() => setDdlOpen(true)}>{t('model.runDdlScript')}</Button>
				</div>
			</div>

			<Tabs value={store.modelTab} onValueChange={(v) => store.setModelTab(v as 'diagram' | 'catalog')} className="flex min-h-0 flex-1 flex-col gap-0">
				<div className="shrink-0 border-b border-border px-3 pt-2">
					<TabsList variant="line" className="h-8">
						<TabsTrigger value="diagram" className="text-xs">{t('model.diagram')}</TabsTrigger>
						<TabsTrigger value="catalog" className="text-xs">{t('model.catalog')}</TabsTrigger>
					</TabsList>
				</div>

				<TabsContent value="diagram" className="m-0 flex min-h-0 flex-1 data-[state=inactive]:hidden">
					<div className="flex min-h-0 min-w-0 flex-1 flex-col">
						<ModelWorkspaceToolbar
							activeViewId={store.activeViewId} viewsRegistry={store.viewsRegistry}
							onViewChange={handleDiagramViewChange} onNewView={handleNewDiagramView}
							onDeleteView={handleDeleteDiagramView}
							columnDetail={store.columnDetail} onColumnDetailChange={(v) => store.setColumnDetail(v as 'full' | 'keys' | 'header')}
							canUndo={store.canUndo} canRedo={store.canRedo} onUndo={store.undo} onRedo={store.redo}
							snapToGrid={store.snapToGrid} onToggleSnap={() => store.setSnapToGrid(!store.snapToGrid)}
							selectedKeysCount={store.selectedKeys.length}
							onAlignLeft={() => {}} onAlignRight={() => {}} onAlignTop={() => {}} onAlignBottom={() => {}}
							onAutoLayoutGrid={handleAutoLayoutGrid} onAutoLayoutTopo={() => {}}
							onAutoLayoutDagre={() => {}} onFitSelection={() => {}}
							onResetViewport={() => store.setViewport({ scale: 1, x: 0, y: 0 })}
							onResetLayout={handleAutoLayoutGrid}
							onAddGroup={() => {}} onCreateTable={() => setCreateTableOpen(true)}
							onExportPng={() => {}} onExportPdf={() => {}}
							onSwitchTab={(tab) => store.setModelTab(tab)}
						/>

						<div className="flex flex-wrap items-center gap-3 border-b border-border px-3 py-1.5 text-[11px] text-muted-foreground">
							<span>{onDiagramCount} / {totalTableCount} tables</span>
							{isPartialDiagram && <button type="button" className="underline underline-offset-2 hover:text-foreground" onClick={handleLoadAllTables}>Load all tables</button>}
							{showInitialSeedHint && <span>{initialSeedReason === 'relationships' ? 'Seeded from foreign key relationships.' : `Showing a sample of ${onDiagramCount} tables.`}</span>}
						</div>

						<div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
							<div ref={diagramWrapRef} className="min-h-0 min-w-0 flex-1 overflow-hidden contain-[layout_paint]">
								<DiagramSurfaceAdapter
									isDark={isDark}
									connectionEngine={connectionEngine}
									initialViewport={store.viewport}
									onViewportSave={(v) => store.setViewport(v)}
									tableDisplays={tableDisplays}
									positions={store.positions}
									columnsByKey={col.diagramDisplayColumnsByKey}
									foreignKeys={foreignKeysQuery.data ?? []}
									selectedKeys={new Set(store.selectedKeys)}
									diagramTool={store.diagramTool}
									onTableSelect={(key, shiftKey) => {
										if (shiftKey) {
											store.setSelectedKeys((prev) =>
												prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key],
											);
										} else {
											store.setSelectedKeys([key]);
										}
									}}
									onClearSelection={() => store.setSelectedKeys([])}
									onTableDragStart={(_k) => {}}
									onTableDragMove={applyTableDragPositions}
									onMoveTable={applyTableDragPositions}
									onRequestColumns={requestColumns}
									onConnectColumns={handleConnectColumns}
									onConnectTables={(from, to) => { requestColumns(from); requestColumns(to); }}
									canConnectColumns={canQueueForeignKey}
									headerColors={resolvedHeaderColors}
									pendingForeignKeys={store.pendingForeignKeys}
									columnDetail={store.columnDetail}
									diagramGroups={store.diagramGroups}
								/>
							</div>
						{inspectorTable && (
							<ModelInspector
								connectionId={connectionId}
								table={inspectorTable}
								tableKeyStr={store.primaryKey}
								defaultDiagramHeaderHex={
									store.primaryKey
										? distinctDiagramHeaderHex(store.primaryKey, isDark)
										: rgbCssToHex(diagramPalette.header)
								}
								tableHeaderColor={
									store.primaryKey ? store.headerColorsByKey[store.primaryKey] : undefined
								}
								onTableHeaderColorChange={(hex) => {
									if (!store.primaryKey) return;
									store.setHeaderColorsByKey((prev) => {
										const next = { ...prev };
										if (hex == null) delete next[store.primaryKey!];
										else next[store.primaryKey!] = hex;
										return next;
									});
								}}
								identityDraft={
									store.primaryKey ? store.identityDraftByKey[store.primaryKey] ?? {
										schema: inspectorTable?.schema ?? "",
										name: inspectorTable?.name ?? "",
									} : null
								}
								onIdentityDraftChange={(next) => {
									if (!store.primaryKey) return;
									store.setIdentityDraftByKey((p) => ({ ...p, [store.primaryKey!]: next }));
								}}
								columnOverrides={
									store.primaryKey ? store.columnOverridesByKey[store.primaryKey] ?? {} : {}
								}
								onColumnOverridesChange={(next) => {
									if (!store.primaryKey) return;
									store.setColumnOverridesByKey((p) => ({ ...p, [store.primaryKey!]: next }));
								}}
								columnIdentityOverrides={
									store.primaryKey
										? store.columnIdentityOverridesByKey[store.primaryKey] ?? {}
										: {}
								}
								onColumnIdentityOverridesChange={(next) => {
									if (!store.primaryKey) return;
									store.setColumnIdentityOverridesByKey((p) => {
										const copy = { ...p };
										if (Object.keys(next).length === 0) delete copy[store.primaryKey!];
										else copy[store.primaryKey!] = next;
										return copy;
									});
								}}
								catalogTables={catalogTablesSorted}
								pendingAddColumns={
									store.primaryKey ? store.pendingAddColumnsByKey[store.primaryKey] ?? [] : []
								}
								onPendingAddColumnsChange={(next) => {
									if (!store.primaryKey) return;
									store.setPendingAddColumnsByKey((p) => {
										const copy = { ...p };
										if (next.length === 0) delete copy[store.primaryKey!];
										else copy[store.primaryKey!] = next;
										return copy;
									});
								}}
								pendingForeignKeys={store.pendingForeignKeys}
								selectedEdge={store.selectedEdge}
								canQueueForeignKey={canQueueForeignKey}
								onAddPendingForeignKey={(row) => {
									const fromKey = row.fromKey ?? store.primaryKey;
									if (!fromKey) return;
									if (!canQueueForeignKey({
										fromKey,
										fromColumn: row.fromColumn,
										toKey: row.toKey,
										toColumn: row.toColumn,
									})) return;
									const id = crypto.randomUUID();
									store.setPendingForeignKeys((prev) => [
										...prev,
										{
											id,
											fromKey,
											fromColumn: row.fromColumn,
											toKey: row.toKey,
											toColumn: row.toColumn,
											constraintName: row.constraintName,
										},
									]);
									store.setSelectedEdge({
										id,
										kind: "pending",
										fromKey,
										fromColumn: row.fromColumn,
										toKey: row.toKey,
										toColumn: row.toColumn,
									});
								}}
								onRemovePendingForeignKey={(id) => {
									store.setPendingForeignKeys((prev) => prev.filter((fk) => fk.id !== id));
									store.setSelectedEdge((prev) => (prev?.id === id ? null : prev));
								}}
								pendingRules={store.pendingRules.filter((row: any) => row.tableKey === store.primaryKey)}
								onPendingRulesChange={(next: any) => {
									if (!store.primaryKey) return;
									store.setPendingRules((prev: any) => [
										...prev.filter((row: any) => row.tableKey !== store.primaryKey),
										...next,
									]);
								}}
								pendingTriggers={store.pendingTriggers.filter((row: any) => row.tableKey === store.primaryKey)}
								onPendingTriggersChange={(next: any) => {
									if (!store.primaryKey) return;
									store.setPendingTriggers((prev: any) => [
										...prev.filter((row: any) => row.tableKey !== store.primaryKey),
										...next,
									]);
								}}
								pendingRlsPolicies={store.pendingRlsPolicies.filter((row: any) => row.tableKey === store.primaryKey)}
								onPendingRlsPoliciesChange={(next: any) => {
									if (!store.primaryKey) return;
									store.setPendingRlsPolicies((prev: any) => [
										...prev.filter((row: any) => row.tableKey !== store.primaryKey),
										...next,
									]);
								}}
							/>
						)}
					</div>
					</div>
				</TabsContent>

				<TabsContent value="catalog" className="m-0 min-h-0 flex-1 data-[state=inactive]:hidden">
					<ModelCatalog
						tables={catalogTablesSorted}
						onCanvasSet={new Set(store.onCanvas)}
						onDiagramCount={onDiagramCount}
						selectedKeys={store.selectedKeys}
						onSelectKey={(k) => { if (k) requestColumns(k); }}
						onAddToCanvas={handleAddToCanvas}
						onRemoveFromCanvas={handleRemoveFromCanvas}
						onRequestColumns={requestColumns}
					/>
				</TabsContent>
			</Tabs>

			<DdlReviewDialog open={ddlOpen} onOpenChange={setDdlOpen} connectionId={connectionId} engine={connectionEngine} />
			<CreateTableDialog open={createTableOpen} onOpenChange={setCreateTableOpen} onCommit={(ct) => store.setPendingCreateTables((prev) => [...prev, ct])} />
			<MigrationPreviewDialog open={migrationPreviewOpen} onOpenChange={setMigrationPreviewOpen} summary={null} onApply={handleApplyEntireModel} isApplying={applyPending} />
		</div>
	);
}
