"use client";

import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { useSupabaseClientWithAuth } from '@/hooks/useSupabaseClientWithAuth';
import { useAuth } from './AuthContext';
import { useToast } from '@/hooks/use-toast';
import { DesignSettings } from '@/types/design';
import { defaultDesignSettingsV2 } from '@/types/design-v2';
import { FlowConfig } from '@/types/flow';
import type { Database } from '@/types/database';
import { compactDesignConfigToV2 } from '@/lib/design-config-v2';

type Instance = Database['public']['Tables']['instances']['Row'];

interface InstanceContextType {
  // Current instance data
  currentInstance: Instance | null;
  currentConfig: DesignSettings;
  currentFlowConfig: FlowConfig | null;
  
  // All instances list
  allInstances: Instance[];
  isLoadingInstances: boolean;
  
  // Loading states
  isLoading: boolean;
  isSaving: boolean;
  lastSaveError: string | null;
  error: string | null;
  
  // Actions
  loadInstance: (instanceId: string) => Promise<void>;
  loadAllInstances: (accountId?: string) => Promise<void>;
  updateInstance: (updates: Partial<Instance>) => Promise<void>;
  updateConfig: (updates: Partial<DesignSettings>) => void;
  updateFlowConfig: (updates: Partial<FlowConfig>) => void;
  deleteInstance: (instanceId: string) => Promise<void>;
  clearInstance: () => void;
  
  // Cache management
  cachedInstances: Map<string, { instance: Instance; config: DesignSettings; flowConfig: FlowConfig | null; timestamp: number }>;
  getCachedInstance: (instanceId: string) => { instance: Instance; config: DesignSettings; flowConfig: FlowConfig | null } | null;
}

const InstanceContext = createContext<InstanceContextType | undefined>(undefined);

export const useInstance = () => {
  const context = useContext(InstanceContext);
  if (!context) {
    throw new Error('useInstance must be used within an InstanceProvider');
  }
  return context;
};

interface InstanceProviderProps {
  children: React.ReactNode;
}

export const InstanceProvider: React.FC<InstanceProviderProps> = ({ children }) => {
  const { session, user } = useAuth();
  const { toast } = useToast();
  const supabase = useSupabaseClientWithAuth();
  
  const [currentInstance, setCurrentInstance] = useState<Instance | null>(null);
  const [currentConfig, setCurrentConfig] = useState<DesignSettings>(defaultDesignSettingsV2);
  const [currentFlowConfig, setCurrentFlowConfig] = useState<FlowConfig | null>(null);
  const [allInstances, setAllInstances] = useState<Instance[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingInstances, setIsLoadingInstances] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [lastSaveError, setLastSaveError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cachedInstances, setCachedInstances] = useState<Map<string, { instance: Instance; config: DesignSettings; flowConfig: FlowConfig | null; timestamp: number }>>(new Map());

  /** Always matches last committed `currentConfig` + synchronous updates in `updateConfig` (avoids stale merges when typing fast). */
  const latestConfigRef = useRef<DesignSettings>(defaultDesignSettingsV2);
  const currentInstanceRef = useRef<Instance | null>(null);
  const currentFlowConfigRef = useRef<FlowConfig | null>(null);
  const sessionRef = useRef(session);
  const configSaveDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshWidgetAfterNextSaveRef = useRef(false);

  // Cache expiration time (5 minutes)
  const CACHE_EXPIRY = 5 * 60 * 1000;

  useEffect(() => {
    latestConfigRef.current = currentConfig;
  }, [currentConfig]);

  useEffect(() => {
    currentInstanceRef.current = currentInstance;
  }, [currentInstance]);

  useEffect(() => {
    currentFlowConfigRef.current = currentFlowConfig;
  }, [currentFlowConfig]);

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  useEffect(() => {
    return () => {
      if (configSaveDebounceRef.current) {
        clearTimeout(configSaveDebounceRef.current);
      }
    };
  }, []);

  // Get cached instance data
  const getCachedInstance = useCallback((instanceId: string) => {
    const cached = cachedInstances.get(instanceId);
    if (!cached) return null;
    
    // Check if cache is expired
    if (Date.now() - cached.timestamp > CACHE_EXPIRY) {
      cachedInstances.delete(instanceId);
      return null;
    }
    
    return { instance: cached.instance, config: cached.config, flowConfig: cached.flowConfig };
  }, [cachedInstances]);

  // Cache instance data
  const cacheInstance = useCallback((instanceId: string, instance: Instance, config: DesignSettings, flowConfig: FlowConfig | null = null) => {
    setCachedInstances(prev => {
      const newCache = new Map(prev);
      newCache.set(instanceId, {
        instance,
        config,
        flowConfig,
        timestamp: Date.now()
      });
      return newCache;
    });
  }, []);

  // Load instance data (with caching)
  const loadInstance = useCallback(async (instanceId: string) => {
    if (!user) {
      throw new Error('User not authenticated');
    }

    setIsLoading(true);
    setError(null);

    try {
      // Check cache first
      const cached = getCachedInstance(instanceId);
      if (cached) {
        setCurrentInstance(cached.instance);
        setCurrentConfig(cached.config);
        setCurrentFlowConfig(cached.flowConfig);
        setIsLoading(false);
        return;
      }

      // Always load via API (handles account-based access using admin+membership)
      let apiInstance: any = null;
      try {
        const accessToken = session?.access_token;
        const headers: Record<string, string> = {
          'Cache-Control': 'no-cache',
          'Content-Type': 'application/json',
        };
        if (accessToken) headers['Authorization'] = `Bearer ${accessToken}`;

        const response = await fetch(`/api/instances/${instanceId}`, {
          headers,
        });

        if (response.ok) {
          const data = await response.json();
          apiInstance = (data && (data.instance ?? data)) as any;
        } else {}
      } catch (apiErr) {}

      if (!apiInstance) {
        // Fallback: direct client-side Supabase query with RLS
        const { data: instanceRow, error: instErr } = await supabase
          .from('instances')
          .select('*')
          .eq('id', instanceId)
          .maybeSingle();
        if (instErr) {
          throw new Error(instErr.message || 'Failed to load instance');
        }
        if (!instanceRow) {
          throw new Error('Instance not found');
        }
        apiInstance = instanceRow as any;
      }

      if (!apiInstance) {
        throw new Error('Instance not found in response');
      }

      // Process instance data (fill V2 defaults + stable ordering).
      const config = compactDesignConfigToV2(apiInstance.config, { fillDefaults: true }) as DesignSettings;

      // Process form config (formerly `instances.flow_config`, now stored in `instances.config.form_config`)
      const rawFormConfig =
        config && typeof (config as any).form_config === 'object' && (config as any).form_config !== null && !Array.isArray((config as any).form_config)
          ? ((config as any).form_config as Record<string, unknown>)
          : null;
      const flowConfig = rawFormConfig
        ? ({ ...rawFormConfig, enabled: Boolean((config as any).form_status_enabled) } as any as FlowConfig)
        : null;

      // Cache the data
      cacheInstance(instanceId, apiInstance, config, flowConfig);

      // Set current state
      setCurrentInstance(apiInstance);
      setCurrentConfig(config);
      setCurrentFlowConfig(flowConfig);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to load instance';
      setError(errorMessage);
      toast({
        title: 'Error loading settings',
        description: 'Failed to load instance settings. Please try refreshing the page.',
        variant: 'destructive',
      });
      throw error;
    } finally {
      setIsLoading(false);
    }
  }, [user, getCachedInstance, cacheInstance, toast, session]);

  // Update instance data
  const updateInstance = useCallback(async (updates: Partial<Instance> & { subcategories?: any[] }) => {
    if (!currentInstance) {
      toast({
        title: 'Not ready',
        description: 'Instance is still loading. Please try again in a moment.',
        variant: 'destructive',
      });
      return;
    }

    setIsSaving(true);

    try {
      // Separate subcategories from other instance updates
      const { subcategories, ...instanceUpdates } = updates;

      // Update instance data through API route (excluding subcategories)
      if (Object.keys(instanceUpdates).length > 0) {
        const apiUrl = `/api/instances/${currentInstance.id}?t=${Date.now()}`;

        const accessToken = session?.access_token;
        const headers: Record<string, string> = {
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Content-Type': 'application/json',
          'Expires': '0',
          'Pragma': 'no-cache',
        };
        if (accessToken) headers['Authorization'] = `Bearer ${accessToken}`;

        const response = await fetch(apiUrl, {
          method: 'PUT',
          headers,
          body: JSON.stringify(instanceUpdates),
        });

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || 'Failed to update instance');
        }

        const result = await response.json();
        if (result.rowsUpdated === 0) {}
      }

      // Handle subcategories separately if they exist
      if (subcategories && Array.isArray(subcategories)) {
        // First, delete existing subcategories for this instance
        const { error: deleteError } = await supabase
          .from('instance_subcategories')
          .delete()
          .eq('instance_id', currentInstance.id);

        if (deleteError) {
          throw deleteError;
        }

        // Then insert new subcategories
        if (subcategories.length > 0) {
          const { error: insertError } = await supabase
            .from('instance_subcategories')
            .insert(subcategories);

          if (insertError) {
            throw insertError;
          }
        }
      }

      // Update local state
      const updatedInstance = { ...currentInstance, ...updates };
      setCurrentInstance(updatedInstance);

      // Update cache
      cacheInstance(currentInstance.id, updatedInstance, currentConfig, currentFlowConfig);

    } catch (error) {
      throw error;
    } finally {
      setIsSaving(false);
    }
  }, [currentInstance, currentConfig, session, cacheInstance]);

  // Update config (debounced save). Merge uses latestConfigRef so rapid input (e.g. width/height) never loses characters.
  const updateConfig = useCallback(
    (updates: Partial<DesignSettings>) => {
      const base = latestConfigRef.current;
      const mergedConfig = { ...base, ...updates } as DesignSettings;
      const orderedLocalConfig = compactDesignConfigToV2(mergedConfig, { fillDefaults: true }) as DesignSettings;
      latestConfigRef.current = orderedLocalConfig;
      setCurrentConfig(orderedLocalConfig);

      const inst = currentInstanceRef.current;
      if (!inst) {
        return;
      }

      setLastSaveError(null);

      if (updates.gallery_columns !== undefined) {
        console.log('updateConfig called with gallery_columns:', updates.gallery_columns, 'type:', typeof updates.gallery_columns);
      }

      if (
        Object.prototype.hasOwnProperty.call(updates, 'form_status_enabled') &&
        Boolean((base as any)?.form_status_enabled) !== Boolean((orderedLocalConfig as any)?.form_status_enabled)
      ) {
        refreshWidgetAfterNextSaveRef.current = true;
      }

      const flow = currentFlowConfigRef.current;
      cacheInstance(inst.id, inst, orderedLocalConfig, flow);
      setCurrentInstance((prev) => (prev ? ({ ...prev, config: orderedLocalConfig } as any) : prev));

      if (configSaveDebounceRef.current) {
        clearTimeout(configSaveDebounceRef.current);
      }

      configSaveDebounceRef.current = setTimeout(async () => {
        configSaveDebounceRef.current = null;
        const instance = currentInstanceRef.current;
        if (!instance) return;

        const toSave = latestConfigRef.current;
        setIsSaving(true);

        try {
          const apiUrl = `/api/instances/${instance.id}/config?t=${Date.now()}`;
          console.log('Sending config to API:', JSON.stringify(toSave, null, 2));

          const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

          const attemptSave = async (attempt: number): Promise<any> => {
            const accessToken = sessionRef.current?.access_token;
            const headers: Record<string, string> = {
              'Cache-Control': 'no-cache, no-store, must-revalidate',
              'Content-Type': 'application/json',
              Expires: '0',
              Pragma: 'no-cache',
            };
            if (accessToken) headers['Authorization'] = `Bearer ${accessToken}`;

            const response = await fetch(apiUrl, {
              method: 'PUT',
              headers,
              body: JSON.stringify({ config: toSave }),
            });

            if (!response.ok) {
              const status = response.status;
              const errorData = await response.json().catch(() => ({}));
              const msg = (errorData as any)?.error || 'Failed to update config';
              if ((status === 500 || status === 503) && attempt < 2) {
                await sleep(250 * Math.pow(2, attempt));
                return attemptSave(attempt + 1);
              }
              throw new Error(msg);
            }

            return response.json().catch(() => ({}));
          };

          await attemptSave(0);

          // Do not replace local config from the response — it can race with continued typing and revert partial input.
          cacheInstance(instance.id, { ...instance, config: toSave } as any, toSave, currentFlowConfigRef.current);

          if (refreshWidgetAfterNextSaveRef.current) {
            refreshWidgetAfterNextSaveRef.current = false;
            try {
              window.dispatchEvent(new Event('designer-refresh-widget-preview'));
            } catch {}
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Failed to save changes';
          setLastSaveError(message);
          toast({
            title: 'Save Error',
            description: 'Failed to save changes. Please try again.',
            variant: 'destructive',
          });
        } finally {
          setIsSaving(false);
        }
      }, 500);
    },
    [cacheInstance, toast]
  );

  // flow_config is deprecated/removed — keep a local FlowConfig object only for legacy UI state.
  // Persist form-mode enablement via `instances.config.form_status_enabled`.
  const updateFlowConfig = useCallback(async (updates: Partial<FlowConfig>) => {
    // Always update local state so any legacy UI reads the latest value.
    const newFlowConfig = currentFlowConfig ? { ...currentFlowConfig, ...updates } : ({ ...updates } as FlowConfig);
    setCurrentFlowConfig(newFlowConfig);

    if (!currentInstance) return;

    cacheInstance(currentInstance.id, currentInstance, currentConfig, newFlowConfig);

    const nextFormConfig = newFlowConfig && typeof newFlowConfig === 'object' ? ({ ...(newFlowConfig as any) } as any) : {};
    delete nextFormConfig.enabled;

    const configUpdates: Partial<DesignSettings> = {
      form_config: nextFormConfig,
    } as any;

    if (Object.prototype.hasOwnProperty.call(updates, 'enabled')) {
      (configUpdates as any).form_status_enabled = Boolean((newFlowConfig as any)?.enabled);
    }

    await updateConfig(configUpdates as any);
  }, [cacheInstance, currentConfig, currentFlowConfig, currentInstance, updateConfig]);

  // Load all instances for the current user and account
  const loadAllInstances = useCallback(async (accountId?: string) => {
    if (!user) return;

    setIsLoadingInstances(true);
    try {
      let query = supabase
        .from('instances')
        .select('*');
      
      // Filter by account_id - instances are tied to accounts
      if (accountId) {
        query = query.eq('account_id', accountId);
      }
      
      const { data, error } = await query.order('created_at', { ascending: false });

      if (error) throw error;
      setAllInstances(data || []);
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to load instances. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setIsLoadingInstances(false);
    }
  }, [user, supabase, toast]);

  // Delete an instance
  const deleteInstance = useCallback(async (instanceId: string) => {
    if (!user) return;

    try {
      const { error } = await supabase
        .from('instances')
        .delete()
        .eq('id', instanceId)
        .eq('user_id', user.id);

      if (error) throw error;

      // Update local state
      setAllInstances(prev => prev.filter(i => i.id !== instanceId));
      
      // Clear from cache
      setCachedInstances(prev => {
        const newCache = new Map(prev);
        newCache.delete(instanceId);
        return newCache;
      });

      // Clear current instance if it's the one being deleted
      if (currentInstance?.id === instanceId) {
        setCurrentInstance(null);
        setCurrentConfig(defaultDesignSettingsV2);
        setCurrentFlowConfig(null);
      }

      toast({
        title: 'Success',
        description: 'Instance deleted successfully',
      });
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to delete instance. Please try again.',
        variant: 'destructive',
      });
      throw error;
    }
  }, [user, supabase, currentInstance, toast]);

  // Clear current instance
  const clearInstance = useCallback(() => {
    setCurrentInstance(null);
    setCurrentConfig(defaultDesignSettingsV2);
    setCurrentFlowConfig(null);
  }, []);

  // Clean up expired cache entries periodically
  useEffect(() => {
    const interval = setInterval(() => {
      setCachedInstances(prev => {
        const newCache = new Map();
        const now = Date.now();
        let hasChanges = false;
        
        prev.forEach((value, key) => {
          if (now - value.timestamp < CACHE_EXPIRY) {
            newCache.set(key, value);
          } else {
            hasChanges = true; // Mark that we're removing expired entries
          }
        });
        
        // Only return new cache if we actually removed expired entries
        return hasChanges ? newCache : prev;
      });
    }, 60000); // Check every minute

    return () => clearInterval(interval);
  }, []);

  const value: InstanceContextType = {
    currentInstance,
    currentConfig,
    currentFlowConfig,
    allInstances,
    isLoadingInstances,
    isLoading,
    isSaving,
    lastSaveError,
    error,
    loadInstance,
    loadAllInstances,
    updateInstance,
    updateConfig,
    updateFlowConfig,
    deleteInstance,
    clearInstance,
    cachedInstances,
    getCachedInstance,
  };

  return (
    <InstanceContext.Provider value={value}>
      {children}
    </InstanceContext.Provider>
  );
}; 
