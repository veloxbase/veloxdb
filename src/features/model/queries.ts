import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { queryKeys } from '@/data/query-keys'
import { veloxDbRepository } from '@/data/repositories'
import type { DdlBatchRequest } from '@/data/types'

export function useForeignKeysQuery(connectionId: string | undefined | null) {
  return useQuery({
    queryKey: queryKeys.foreignKeys(connectionId),
    queryFn: () => veloxDbRepository.getForeignKeys(connectionId ?? undefined),
    enabled: Boolean(connectionId),
    staleTime: 60 * 1000,
  })
}

export function useExecuteDdlTransactionMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (request: DdlBatchRequest) => veloxDbRepository.executeDdlTransaction(request),
    onSuccess: (_data, variables) => {
      const id = variables.connectionId
      void queryClient.invalidateQueries({ queryKey: queryKeys.tables(id) })
      void queryClient.invalidateQueries({ queryKey: queryKeys.foreignKeys(id) })
      void queryClient.invalidateQueries({ queryKey: ['schema'] })
      void queryClient.invalidateQueries({ queryKey: ['tableProperties'] })
    },
  })
}
