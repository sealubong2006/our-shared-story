import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AccessState } from "@family-album/shared";
import { api } from "./api";

const ACCESS_KEY = ["access"] as const;

export function useAccess() {
  return useQuery({
    queryKey: ACCESS_KEY,
    queryFn: () => api<AccessState>("/access/me"),
    staleTime: 60_000,
  });
}

/** Enter a code of the given kind; on success the access state is updated everywhere. */
export function useEnterCode(kind: "view" | "download" | "admin") {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (code: string) => api<AccessState>(`/access/${kind}`, { body: { code } }),
    onSuccess: (state) => queryClient.setQueryData(ACCESS_KEY, state),
  });
}

export function useSignOut() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (scope: "admin" | "all") => api<void>("/access/sign-out", { body: { scope } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ACCESS_KEY }),
  });
}
