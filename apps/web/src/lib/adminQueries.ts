import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  ActivityDto,
  CreateShareLink,
  CreatedShareLink,
  DownloadLogDto,
  IssuedCode,
  SettingsOverview,
  ShareLinkDto,
} from "@family-album/shared";
import { api } from "./api";

// ---------------------------------------------------------------- sharing

export const useShareLinks = () =>
  useQuery({ queryKey: ["admin", "share-links"], queryFn: () => api<ShareLinkDto[]>("/admin/share-links") });

export function useCreateShareLink() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateShareLink) => api<CreatedShareLink>("/admin/share-links", { body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "share-links"] }),
  });
}

export function useRevokeShareLink() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/admin/share-links/${id}/revoke`, { body: {} }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "share-links"] }),
  });
}

// ---------------------------------------------------------------- settings

const SETTINGS_KEY = ["admin", "settings"];

export const useSettings = () =>
  useQuery({ queryKey: SETTINGS_KEY, queryFn: () => api<SettingsOverview>("/admin/settings") });

function useSettingsMutation<V, R>(fn: (vars: V) => Promise<R>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: SETTINGS_KEY });
      void qc.invalidateQueries({ queryKey: ["admin", "activity"] });
    },
  });
}

export const useRotateCode = () =>
  useSettingsMutation(({ scope, code }: { scope: "view" | "download"; code?: string }) =>
    api<IssuedCode>(`/admin/codes/${scope}`, { body: { code: code || undefined } }),
  );

export const useAddAdmin = () =>
  useSettingsMutation(({ name, code }: { name: string; code?: string }) =>
    api<IssuedCode>("/admin/admins", { body: { name, code: code || undefined } }),
  );

export const useResetAdminCode = () =>
  useSettingsMutation(({ id, code }: { id: string; code?: string }) =>
    api<IssuedCode>(`/admin/admins/${id}/reset-code`, { body: { code: code || undefined } }),
  );

export const useSetAdminActive = () =>
  useSettingsMutation(({ id, active }: { id: string; active: boolean }) =>
    api<void>(`/admin/admins/${id}`, { method: "PATCH", body: { active } }),
  );

export const useRevokeSessions = () =>
  useSettingsMutation((scope: "visitors" | "download" | "share") =>
    api<{ count: number }>("/admin/sessions/revoke", { body: { scope } }),
  );

export const useDownloadLog = () =>
  useQuery({ queryKey: ["admin", "downloads"], queryFn: () => api<DownloadLogDto[]>("/admin/downloads") });

export const useActivity = () =>
  useQuery({ queryKey: ["admin", "activity"], queryFn: () => api<ActivityDto[]>("/admin/activity") });
