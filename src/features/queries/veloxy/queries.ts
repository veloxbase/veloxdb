import { type QueryClient, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { queryKeys } from "@/data/query-keys";
import { veloxDbRepository } from "@/data/repositories";
import { importLegacyVeloxyThread, cancelPendingVeloxyWrite } from "@/features/queries/veloxy/sqlite-persistence";

export function invalidateVeloxyThreadLists(queryClient: QueryClient, connectionId: string): void {
	void queryClient.invalidateQueries({ queryKey: queryKeys.veloxyThreads(connectionId) });
}

export function useVeloxyThreadsQuery(
	connectionId: string | null,
	databaseName?: string | null,
) {
	return useQuery({
		queryKey: queryKeys.veloxyThreads(connectionId),
		enabled: Boolean(connectionId),
		staleTime: 5_000,
		queryFn: async () => {
			const id = connectionId as string;
			let threads = await veloxDbRepository.listVeloxyThreads(id);
			if (threads.length === 0) {
				const imported = await importLegacyVeloxyThread(id, databaseName);
				if (imported) {
					threads = await veloxDbRepository.listVeloxyThreads(id);
				}
			}
			return threads;
		},
	});
}

export function useTouchVeloxyThreadMutation() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (input: { id: string; connectionId: string }) =>
			veloxDbRepository.touchVeloxyThread(input.id),
		onSuccess: (_void, input) => {
			invalidateVeloxyThreadLists(queryClient, input.connectionId);
		},
	});
}

export function useDeleteVeloxyThreadMutation() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (input: { id: string; connectionId: string }) => {
			cancelPendingVeloxyWrite(input.id);
			return veloxDbRepository.deleteVeloxyThread(input.id);
		},
		onSuccess: (_void, input) => {
			invalidateVeloxyThreadLists(queryClient, input.connectionId);
			queryClient.removeQueries({ queryKey: queryKeys.veloxyThread(input.id) });
		},
	});
}
