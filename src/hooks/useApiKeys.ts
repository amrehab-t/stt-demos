import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { ApiKeyStatus } from "@/lib/types";

interface KeyInfo {
  provider_id: string;
  status: ApiKeyStatus;
  updated_at: string;
}

export function useApiKeys() {
  const [keys, setKeys] = useState<Record<string, KeyInfo>>({});
  const [loading, setLoading] = useState(true);

  const fetchKeys = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.functions.invoke("manage-api-keys", {
      method: "GET",
    });
    if (!error && data?.keys) {
      const map: Record<string, KeyInfo> = {};
      for (const k of data.keys) {
        map[k.provider_id] = k;
      }
      setKeys(map);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchKeys();
  }, [fetchKeys]);

  const saveKey = useCallback(async (providerId: string, apiKey: string) => {
    const { data, error } = await supabase.functions.invoke("manage-api-keys", {
      method: "POST",
      body: { provider_id: providerId, api_key: apiKey },
    });
    if (error) throw error;
    if (data?.error) throw new Error(data.error);
    await fetchKeys();
    return data;
  }, [fetchKeys]);

  const testKey = useCallback(async (providerId: string, apiKey?: string) => {
    const { data, error } = await supabase.functions.invoke("manage-api-keys", {
      method: "POST",
      body: { provider_id: providerId, api_key: apiKey, action: "test" },
    });
    if (error) throw error;
    await fetchKeys();
    return data as { valid: boolean; error?: string };
  }, [fetchKeys]);

  const deleteKey = useCallback(async (providerId: string) => {
    const { data, error } = await supabase.functions.invoke("manage-api-keys", {
      method: "DELETE",
      body: { provider_id: providerId },
    });
    if (error) throw error;
    if (data?.error) throw new Error(data.error);
    await fetchKeys();
    return data;
  }, [fetchKeys]);

  const getStatus = useCallback(
    (providerId: string): ApiKeyStatus => {
      return (keys[providerId]?.status as ApiKeyStatus) || "not_configured";
    },
    [keys]
  );

  return { keys, loading, saveKey, testKey, deleteKey, getStatus, refetch: fetchKeys };
}
