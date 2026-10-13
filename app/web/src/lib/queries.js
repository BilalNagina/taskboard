// Server data via TanStack Query: cached, shared between pages, refetched after changes.
import { QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from './api.js';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: true,
      // Don't retry "not found" or "sign in required"; those won't fix themselves.
      retry: (count, err) => !(err instanceof ApiError && err.status < 500) && count < 2,
    },
  },
});

export const keys = {
  me: ['me'],
  workspaces: ['workspaces'],
  boards: (workspaceId) => ['boards', workspaceId],
  board: (id) => ['board', id],
  boardFull: (id) => ['boardFull', id],
  task: (id) => ['task', id],
  activity: (boardId) => ['activity', boardId],
  members: (workspaceId) => ['members', workspaceId],
  invites: (workspaceId) => ['invites', workspaceId],
  myInvites: ['myInvites'],
};

// null when signed out (401), the user otherwise.
export function useMe() {
  return useQuery({
    queryKey: keys.me,
    queryFn: () =>
      api.me().then(
        ({ user }) => user,
        (err) => {
          if (err instanceof ApiError && err.status === 401) return null;
          throw err;
        },
      ),
    staleTime: 5 * 60_000,
  });
}

export const useWorkspaces = () => useQuery({ queryKey: keys.workspaces, queryFn: api.workspaces });

export const useBoards = (workspaceId) =>
  useQuery({ queryKey: keys.boards(workspaceId), queryFn: () => api.boards(workspaceId), enabled: Boolean(workspaceId) });

export const useBoard = (id) => useQuery({ queryKey: keys.board(id), queryFn: () => api.board(id), enabled: Boolean(id) });

export const useBoardFull = (id) =>
  useQuery({ queryKey: keys.boardFull(id), queryFn: () => api.boardFull(id), enabled: Boolean(id) });

export const useTask = (id) => useQuery({ queryKey: keys.task(id), queryFn: () => api.task(id), enabled: Boolean(id) });

export const useBoardActivity = (boardId, enabled = true) =>
  useQuery({ queryKey: keys.activity(boardId), queryFn: () => api.boardActivity(boardId), enabled: Boolean(boardId) && enabled });

export const useMembers = (workspaceId) =>
  useQuery({ queryKey: keys.members(workspaceId), queryFn: () => api.members(workspaceId), enabled: Boolean(workspaceId) });

export const useInvites = (workspaceId, enabled = true) =>
  useQuery({ queryKey: keys.invites(workspaceId), queryFn: () => api.invites(workspaceId), enabled: Boolean(workspaceId) && enabled });

// A mutation that refreshes the given query keys when it succeeds.
export function useAction(fn, { invalidate = [], onSuccess } = {}) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: async (data, variables) => {
      await Promise.all(invalidate.map((queryKey) => client.invalidateQueries({ queryKey })));
      onSuccess?.(data, variables);
    },
  });
}

// Invites addressed to me, shown as a banner in the app until accepted or declined.
export const useMyInvites = () => useQuery({ queryKey: keys.myInvites, queryFn: api.myInvites, refetchInterval: 60_000 });
