'use client';

import { useInstance } from '@/contexts/InstanceContext';
import { useAuth } from '@/contexts/AuthContext';
import { useAccountPlan } from '@/hooks/use-account-plan';
import { Loader2, ChevronLeft, Monitor, Smartphone, Code, Rocket, Maximize2, X, RefreshCw } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState, useRef } from 'react';
import LeftSidebar from '@/components/designer/LeftSidebar';
import { Button } from '@/components/ui/button';
import { WidgetPageView } from '@/components/features/WidgetPageView';
import SettingsInputViewerLazy from '@/components/features/SettingsInputViewerLazy';
import { SubcategoryGalleryNotification } from '@/components/features/SubcategoryGalleryNotification';
import { PlaceholderImagesGenerateModal } from '@/components/features/PlaceholderImagesGenerateModal';
import { PlaceholderImagesPanel } from '@/components/features/PlaceholderImagesPanel';

interface Props {
  accountId: string;
  instanceId: string;
}

export default function ClientDesignInstancePage({ accountId, instanceId }: Props) {
  const { isLoading: authLoading, user } = useAuth();
  const {
    currentConfig,
    currentInstance,
    error,
    isLoading: instanceLoading,
    isSaving,
    lastSaveError,
    loadInstance,
    updateConfig,
  } = useInstance();
  const { isPartner, loading: planLoading } = useAccountPlan();
  const [activeTab, setActiveTab] = useState<'design' | 'settings' | 'launch'>('settings');
  const [previewMode, setPreviewMode] = useState<'desktop' | 'mobile' | 'iframe' | 'modal'>('desktop');
  const [isExpanded, setIsExpanded] = useState(true);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [openSections, setOpenSections] = useState<Record<string, Record<string, boolean>>>({});
  const [selectedSettingsItem, setSelectedSettingsItem] = useState<string>('basic-info');
  const [showPlaceholderNotification, setShowPlaceholderNotification] = useState(true);
  const [isPlaceholderGenerateOpen, setIsPlaceholderGenerateOpen] = useState(false);
  const [isPlaceholderManageOpen, setIsPlaceholderManageOpen] = useState(false);
  const [placeholderGalleryCount, setPlaceholderGalleryCount] = useState<number | null>(null);
  const [isRefreshingSession, setIsRefreshingSession] = useState(false);
  const hasLoadedInstance = useRef(false);

  // Unified /adventure preview: `instances.config` is the single source of truth.
  const previewDesignConfig = currentConfig;

  const previewModeType = Boolean((currentConfig as any)?.form_status_enabled) ? "form" : "widget";

  // Keep one embedded iframe mounted across Design / Settings / Launch so tab switches
  // do not reload the widget. Updated while on Design or Launch (non-modal); frozen while
  // on Settings so hidden preview props stay stable.
  const lastEmbeddedPreviewRef = useRef<{
    fullPage: boolean;
    previewMode: 'desktop' | 'mobile' | 'iframe';
  }>({ fullPage: true, previewMode: 'desktop' });
  if (!isPartner && activeTab === 'design') {
    lastEmbeddedPreviewRef.current = {
      fullPage: true,
      previewMode: previewMode === 'modal' ? 'desktop' : previewMode,
    };
  } else if (!isPartner && activeTab === 'launch' && previewMode !== 'modal') {
    lastEmbeddedPreviewRef.current = {
      fullPage: previewMode === 'desktop',
      previewMode,
    };
  }
  const showLaunchModal = activeTab === 'launch' && previewMode === 'modal';
  const showEmbeddedWidgetPreview = !isPartner && !showLaunchModal;

  useEffect(() => {
    if (!isPlaceholderGenerateOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsPlaceholderGenerateOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isPlaceholderGenerateOpen]);

  useEffect(() => {
    hasLoadedInstance.current = false;
  }, [instanceId]);

  useEffect(() => {
    if (lastSaveError) {
      setSaveStatus('error');
      const t = setTimeout(() => setSaveStatus('idle'), 3000);
      return () => clearTimeout(t);
    }
    if (isSaving) {
      setSaveStatus('saving');
    } else if (saveStatus === 'saving') {
      setSaveStatus('saved');
      const t = setTimeout(() => setSaveStatus('idle'), 2000);
      return () => clearTimeout(t);
    }
  }, [isSaving, lastSaveError, saveStatus]);

  useEffect(() => {
    if (currentInstance && currentInstance.id === instanceId) {
      hasLoadedInstance.current = true;
      return;
    }
    if (hasLoadedInstance.current) {
      return;
    }
    if (user && instanceId) {
      hasLoadedInstance.current = true;
      loadInstance(instanceId).catch(() => {
        hasLoadedInstance.current = false;
      });
    }
  }, [instanceId, user, authLoading, currentInstance, loadInstance]);

  useEffect(() => {
    if (!currentInstance) return;
    if (activeTab !== 'settings') return;
    if (selectedSettingsItem !== 'basic-info') return;
    if (Object.keys(openSections.settings || {}).length > 0) return;

    if ((currentInstance as any)?.instance_type === 'service') {
      setSelectedSettingsItem('industry-services');
      setOpenSections((prev) => ({
        ...prev,
        settings: {
          ...(prev.settings || {}),
          instance: true,
        },
      }));
    }
  }, [activeTab, currentInstance, openSections.settings, selectedSettingsItem]);

  // Set correct initial tab based on plan type
  useEffect(() => {
    if (!planLoading) {
      if (isPartner) {
        // Partner plans should always use settings tab
        setActiveTab('settings');
      } else {
        // Non-partner plans can use design tab
        setActiveTab('design');
      }
    }
  }, [isPartner, planLoading]);

  const fetchPlaceholderGalleryCount = async () => {
    const res = await fetch(`/api/sample_image_gallery?instanceId=${instanceId}`, { cache: "no-store" });
    if (!res.ok) return 0;
    const data = await res.json().catch(() => null);
    return Array.isArray(data?.galleryImages) ? data.galleryImages.length : 0;
  };

  const refreshPlaceholderGalleryCount = async () => {
    try {
      const count = await fetchPlaceholderGalleryCount();
      setPlaceholderGalleryCount(count);
      // Enforce: cannot be enabled if no images exist.
      if (count === 0 && (currentConfig as any)?.gallery_show_placeholder_images) {
        updateConfig({ gallery_show_placeholder_images: false } as any);
      }
      return count;
    } catch {
      return 0;
    }
  };

  useEffect(() => {
    // Keep the count fresh when instance changes / loads.
    void refreshPlaceholderGalleryCount();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instanceId]);

  const openPlaceholderImagesFlow = async () => {
    setActiveTab('design');
    setShowPlaceholderNotification(false);
    setOpenSections((prev) => ({
      ...prev,
      design: {
        ...prev.design,
        gallery: true,
      },
    }));

    const count = await refreshPlaceholderGalleryCount();
    if (count > 0) {
      setIsPlaceholderManageOpen(true);
      setIsPlaceholderGenerateOpen(false);
      return;
    }
    setIsPlaceholderManageOpen(false);
    setIsPlaceholderGenerateOpen(true);
  };

  const handleTabChange = (tab: string) => {
    // Prevent partner users from accessing design tab
    if (isPartner && tab === 'design') {
      console.log('Partner plan: Blocked access to design tab');
      return;
    }
    // Modal preview is only supported on the Launch tab.
    if (tab === 'design' && previewMode === 'modal') {
      setPreviewMode('desktop');
    }
    setActiveTab(tab as 'design' | 'settings' | 'launch');
    if (tab !== 'design') {
      setIsPlaceholderGenerateOpen(false);
      setIsPlaceholderManageOpen(false);
    }
  };

  const refreshGenerationSession = () => {
    // This forces the preview iframe to reload (new runtime session).
    setIsRefreshingSession(true);
    window.dispatchEvent(new CustomEvent('designer-refresh-widget-preview'));
    window.setTimeout(() => setIsRefreshingSession(false), 1200);
  };

  if (!user && !authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-transparent">
        <div className="text-center">
          <h1 className="text-2xl font-bold mb-4">Route Working!</h1>
          <p className="text-muted-foreground mb-4">Instance ID: {instanceId}</p>
          <p className="text-xs text-muted-foreground">No user found, but route is accessible</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-transparent">
        <div className="text-center max-w-md mx-auto p-6">
          <h2 className="text-lg font-semibold mb-2">Instance Not Found</h2>
          <p className="text-muted-foreground mb-4">You may not have permission to access it.</p>
          <p className="text-xs text-muted-foreground mb-4">Instance ID: {instanceId}</p>
          <p className="text-xs text-red-400 mb-4">{error}</p>
          <Link 
            href={`/${accountId}/designer-instances`} 
            className="inline-flex items-center px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors"
          >
            <ChevronLeft className="w-4 h-4 mr-2" />
            Back to Adventures
          </Link>
        </div>
      </div>
    );
  }

  if (instanceLoading || !currentInstance || planLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-transparent">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  return (
    <div className="h-screen w-full flex bg-transparent overflow-hidden">
      {/* STEP 7: ADD BACK LEFTSIDEBAR TO TEST */}
      <LeftSidebar
        instanceId={currentInstance.id}
        isExpanded={isExpanded}
        onToggleExpanded={() => setIsExpanded(!isExpanded)}
        activeTab={activeTab}
        onTabChange={handleTabChange}
        saveStatus={saveStatus}
        openSections={openSections}
        onOpenPlaceholderImages={openPlaceholderImagesFlow}
        placeholderGalleryCount={placeholderGalleryCount}
        toggleSection={(tab: string, section: string) => {
          setOpenSections(prev => ({
            ...prev,
            [tab]: {
              ...prev[tab],
              [section]: !prev[tab]?.[section]
            }
          }));
        }}
        selectedSettingsItem={selectedSettingsItem}
        onSettingsItemSelect={setSelectedSettingsItem}
      />

      <div className="flex-1 flex flex-col min-w-0 min-h-0">
        <div className="border-b border-border/50 bg-card/60 backdrop-blur flex-shrink-0 shadow-sm">
          <div className="flex items-center justify-between px-4 py-2">
            <div className="flex items-center gap-3">
            </div>
            <div className="flex items-center gap-3">
              {(activeTab === 'launch' || activeTab === 'design') && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-8 rounded-full border border-border/60 bg-card/40 px-3 text-xs text-muted-foreground shadow-sm backdrop-blur hover:text-foreground hover:bg-accent/50 transition-colors"
                  onClick={refreshGenerationSession}
                  disabled={isRefreshingSession}
                  aria-label="Refresh generation session"
                  title="Refresh generation session"
                >
                  <RefreshCw className={isRefreshingSession ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"} />
                  <span className="ml-2">Refresh</span>
                </Button>
              )}
              {(activeTab === 'launch' || activeTab === 'design') && (
                <div className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-background/40 p-1 shadow-sm">
                  <Button
                    variant={previewMode === 'desktop' ? 'default' : 'ghost'}
                    size="sm"
                    className="h-8 rounded-full px-3 text-xs"
                    onClick={() => setPreviewMode('desktop')}
                  >
                    <Monitor className="h-3 w-3 mr-1" />
                    Desktop
                  </Button>
                  <Button
                    variant={previewMode === 'mobile' ? 'default' : 'ghost'}
                    size="sm"
                    className="h-8 rounded-full px-3 text-xs"
                    onClick={() => setPreviewMode('mobile')}
                  >
                    <Smartphone className="h-3 w-3 mr-1" />
                    Mobile
                  </Button>
                  <Button
                    variant={previewMode === 'iframe' ? 'default' : 'ghost'}
                    size="sm"
                    className="h-8 rounded-full px-3 text-xs"
                    onClick={() => setPreviewMode('iframe')}
                  >
                    <Code className="h-3 w-3 mr-1" />
                    Code
                  </Button>
                  {activeTab === 'launch' && (
                    <Button
                      variant={previewMode === 'modal' ? 'default' : 'ghost'}
                      size="sm"
                      className="h-8 rounded-full px-3 text-xs"
                      onClick={() => setPreviewMode('modal')}
                    >
                      <Maximize2 className="h-3 w-3 mr-1" />
                      Modal
                    </Button>
                  )}
                </div>
              )}
              <Link 
                href={`/${accountId}/designer-instances`} 
                className="inline-flex items-center h-8 px-3 text-xs rounded-full border border-border/60 bg-card/40 text-muted-foreground shadow-sm backdrop-blur hover:text-foreground hover:bg-accent/50 transition-colors"
                aria-label="Exit to instances"
                title="Exit to instances"
              >
                <X className="w-3 h-3 mr-1" />
                Exit
              </Link>
            </div>
          </div>
        </div>
        
        <div className="flex-1 min-h-0 relative bg-transparent overflow-hidden">
          {showLaunchModal && (
            <div className="absolute inset-0 z-[5] bg-zinc-100 dark:bg-zinc-900 overflow-auto">
              <div
                className="min-h-full w-full flex items-center justify-center p-8"
                style={{
                  backgroundColor: currentConfig.modal_backdrop_color
                    ? `${currentConfig.modal_backdrop_color}${Math.round((currentConfig.modal_backdrop_opacity || 0.5) * 255)
                        .toString(16)
                        .padStart(2, '0')}`
                    : 'rgba(0, 0, 0, 0.5)',
                }}
              >
                <div
                  className="rounded-lg shadow-2xl overflow-hidden flex flex-col"
                  style={{
                    backgroundColor: currentConfig.modal_background_color || '#ffffff',
                    borderRadius: currentConfig.modal_border_radius ? `${currentConfig.modal_border_radius}px` : '12px',
                    height: currentConfig.modal_height || '80%',
                    maxHeight: currentConfig.modal_max_height ? `${currentConfig.modal_max_height}px` : '800px',
                    maxWidth: currentConfig.modal_max_width ? `${currentConfig.modal_max_width}px` : '600px',
                    width: currentConfig.modal_width || '80%',
                  }}
                >
                  {currentConfig.modal_show_close_button !== false && (
                    <div className="flex justify-end p-4 border-b border-border/60 flex-shrink-0">
                      <button
                        className="transition-colors duration-200"
                        style={{
                          backgroundColor: 'transparent',
                          border: 'none',
                          borderRadius: '4px',
                          color: currentConfig.modal_close_button_color || '#6b7280',
                          cursor: 'pointer',
                          fontSize: '20px',
                          padding: '4px',
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.color = currentConfig.modal_close_button_hover_color || '#374151';
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.color = currentConfig.modal_close_button_color || '#6b7280';
                        }}
                      >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  )}

                  <div className="flex-1 min-h-0 overflow-auto">
                    <WidgetPageView
                      instanceId={instanceId}
                      previewMode="desktop"
                      liveConfig={previewDesignConfig}
                      mode={previewModeType}
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

          {showEmbeddedWidgetPreview && (
            <div
              className={`absolute inset-0 flex flex-col min-w-0 min-h-0 bg-zinc-100 dark:bg-zinc-900 ${
                activeTab === 'settings' ? 'invisible pointer-events-none' : ''
              }`}
              aria-hidden={activeTab === 'settings'}
            >
              {activeTab === 'design' &&
                showPlaceholderNotification &&
                (currentConfig as any)?.gallery_show_placeholder_images !== false && (
                  <div className="absolute top-4 left-4 right-4 z-10 max-w-md">
                    <SubcategoryGalleryNotification
                      instanceId={instanceId}
                      onDismiss={() => setShowPlaceholderNotification(false)}
                      onClick={openPlaceholderImagesFlow}
                    />
                  </div>
                )}

              <div className="relative flex-1 w-full min-h-0 min-w-0 overflow-hidden flex flex-col">
                <WidgetPageView
                  instanceId={instanceId}
                  fullPage={lastEmbeddedPreviewRef.current.fullPage}
                  previewMode={lastEmbeddedPreviewRef.current.previewMode}
                  liveConfig={previewDesignConfig}
                  mode={previewModeType}
                />

                {activeTab === 'design' && isPlaceholderManageOpen && (placeholderGalleryCount ?? 0) > 0 && (
                  <div
                    className="absolute inset-0 z-30"
                    role="dialog"
                    aria-modal="true"
                    aria-label="Manage placeholder images"
                  >
                    <PlaceholderImagesPanel
                      instanceId={instanceId}
                      onClose={() => setIsPlaceholderManageOpen(false)}
                      onGalleryUpdated={async () => {
                        const count = await refreshPlaceholderGalleryCount();
                        if (count === 0) {
                          setIsPlaceholderManageOpen(false);
                          setIsPlaceholderGenerateOpen(true);
                        }
                        window.dispatchEvent(new CustomEvent('designer-refresh-widget-preview'));
                      }}
                    />
                  </div>
                )}

                {activeTab === 'design' && isPlaceholderGenerateOpen && (
                  <div
                    className="absolute inset-0 z-30"
                    role="dialog"
                    aria-modal="true"
                    aria-label="Generate placeholder images"
                  >
                    <PlaceholderImagesGenerateModal
                      instanceId={instanceId}
                      accountId={currentInstance.account_id as any}
                      onClose={() => setIsPlaceholderGenerateOpen(false)}
                      onGenerated={async () => {
                        try {
                          const count = await refreshPlaceholderGalleryCount();
                          if (count > 0) {
                            updateConfig({ gallery_show_placeholder_images: true } as any);
                            window.dispatchEvent(new CustomEvent('designer-refresh-widget-preview'));
                          }
                          setIsPlaceholderGenerateOpen(false);
                          if (count > 0) setIsPlaceholderManageOpen(true);
                        } catch {}
                      }}
                    />
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === 'settings' && (
            <div className="absolute inset-0 z-10 flex-1 h-full bg-background overflow-auto">
              <SettingsInputViewerLazy
                instanceId={instanceId}
                selectedItem={selectedSettingsItem}
                onComplete={() => {}}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
