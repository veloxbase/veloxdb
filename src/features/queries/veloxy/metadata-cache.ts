import type { ForeignKeyEdge, QueryEditorMetadata } from "@/data/types";
import { veloxDbRepository } from "@/data/repositories";

/**
 * Short-lived cache of catalog metadata for Veloxy. One agent turn can hit
 * search_schema / describe_table / the system-prompt brief several times;
 * without this every call re-reads pg_catalog.
 */
const TTL_MS = 60_000;
export const VELOXY_CATALOG_TIMEOUT_MS = 8_000;

type Entry<T> = { value: Promise<T>; at: number };
type Resolved<T> = { value: T; at: number };

const metadataCache = new Map<string, Entry<QueryEditorMetadata>>();
const foreignKeyCache = new Map<string, Entry<ForeignKeyEdge[]>>();
const resolvedMetadata = new Map<string, Resolved<QueryEditorMetadata>>();
const resolvedForeignKeys = new Map<string, Resolved<ForeignKeyEdge[]>>();

export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => {
			reject(new Error(`${label} timed out after ${Math.round(ms / 1000)}s`));
		}, ms);
		promise.then(
			(value) => {
				clearTimeout(timer);
				resolve(value);
			},
			(error) => {
				clearTimeout(timer);
				reject(error);
			},
		);
	});
}

function fromCache<T>(
	cache: Map<string, Entry<T>>,
	resolved: Map<string, Resolved<T>>,
	key: string,
	load: () => Promise<T>,
): Promise<T> {
	const hit = resolved.get(key);
	if (hit && Date.now() - hit.at < TTL_MS) return Promise.resolve(hit.value);
	const existing = cache.get(key);
	if (existing && Date.now() - existing.at < TTL_MS) return existing.value;
	const value = load();
	cache.set(key, { value, at: Date.now() });
	value.then((loaded) => {
		resolved.set(key, { value: loaded, at: Date.now() });
	});
	value.catch(() => {
		if (cache.get(key)?.value === value) cache.delete(key);
		resolved.delete(key);
	});
	return value;
}

export function peekVeloxyMetadata(connectionId: string): QueryEditorMetadata | null {
	const hit = resolvedMetadata.get(connectionId);
	if (!hit || Date.now() - hit.at >= TTL_MS) return null;
	return hit.value;
}

export function peekVeloxyForeignKeys(connectionId: string): ForeignKeyEdge[] | null {
	const hit = resolvedForeignKeys.get(connectionId);
	if (!hit || Date.now() - hit.at >= TTL_MS) return null;
	return hit.value;
}

export function getVeloxyMetadata(connectionId: string): Promise<QueryEditorMetadata> {
	return withTimeout(
		fromCache(metadataCache, resolvedMetadata, connectionId, () =>
			veloxDbRepository.getQueryEditorMetadata(connectionId),
		),
		VELOXY_CATALOG_TIMEOUT_MS,
		"Schema catalog",
	);
}

export function getVeloxyForeignKeys(connectionId: string): Promise<ForeignKeyEdge[]> {
	return withTimeout(
		fromCache(foreignKeyCache, resolvedForeignKeys, connectionId, () =>
			veloxDbRepository.getForeignKeys(connectionId),
		),
		VELOXY_CATALOG_TIMEOUT_MS,
		"Foreign keys",
	);
}

/** Warm the catalog as soon as a connection is selected so describe_table is instant. */
export function preloadVeloxyCatalog(connectionId: string): void {
	void getVeloxyMetadata(connectionId).catch(() => undefined);
	void getVeloxyForeignKeys(connectionId).catch(() => undefined);
}

export function invalidateVeloxyMetadata(connectionId?: string): void {
	if (connectionId) {
		metadataCache.delete(connectionId);
		foreignKeyCache.delete(connectionId);
		resolvedMetadata.delete(connectionId);
		resolvedForeignKeys.delete(connectionId);
		return;
	}
	metadataCache.clear();
	foreignKeyCache.clear();
	resolvedMetadata.clear();
	resolvedForeignKeys.clear();
}
