import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { queryKeys } from '@/data/query-keys'
import { veloxDbRepository } from '@/data/repositories'
import type { DdlBatchRequest, DdlStatementRequest } from '@/data/types'

export function useForeignKeysQuery(connectionId: string | undefined | null) {
  return useQuery({
    queryKey: queryKeys.foreignKeys(connectionId),
    queryFn: () => veloxDbRepository.getForeignKeys(connectionId ?? undefined),
    enabled: Boolean(connectionId),
    staleTime: 60 * 1000,
  })
}

function invalidateSchemaQueries(queryClient: ReturnType<typeof useQueryClient>, connectionId?: string) {
  void queryClient.invalidateQueries({ queryKey: queryKeys.tables(connectionId) })
  void queryClient.invalidateQueries({ queryKey: queryKeys.foreignKeys(connectionId) })
  void queryClient.invalidateQueries({ queryKey: ['schema'] })
  void queryClient.invalidateQueries({ queryKey: ['tableProperties'] })
  void queryClient.invalidateQueries({ queryKey: ['tableIndexes'] })
}

export function useExecuteDdlTransactionMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (request: DdlBatchRequest) => veloxDbRepository.executeDdlTransaction(request),
    onSuccess: (_data, variables) => {
      invalidateSchemaQueries(queryClient, variables.connectionId)
    },
  })
}

export function useExecuteDdlStatementMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (request: DdlStatementRequest) => veloxDbRepository.executeDdlStatement(request),
    onSuccess: (_data, variables) => {
      invalidateSchemaQueries(queryClient, variables.connectionId)
    },
  })
}
