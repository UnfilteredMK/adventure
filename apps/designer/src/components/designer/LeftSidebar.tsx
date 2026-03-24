"use client";

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { 
  ChevronLeft, 
  ChevronRight, 
  ChevronDown,
  Settings, 
  Palette, 
  Rocket, 
  Sparkles,
  Image as ImageIcon,
  Images,
  FileText,
  Mail,
} from 'lucide-react';
import { useInstance } from '@/contexts/InstanceContext';
import { useAccountPlan } from '@/hooks/use-account-plan';
import { DesignTabV2 } from '@/components/features/DesignTabV2';
import { SettingsTab } from '@/components/features/SettingsTab';
import { LaunchTab } from '@/components/features/LaunchTab';
import { NumberInput } from '@/components/features/FormComponents';
import { useToast } from '@/hooks/use-toast';

interface LeftSidebarProps {
  activeTab: string;
  onOpenPlaceholderImages?: () => void;
  placeholderGalleryCount?: number | null;
  instanceId: string;
  isExpanded: boolean;
  onSettingsItemSelect: (itemId: string) => void;
  onTabChange: (tab: string) => void;
  onToggleExpanded: () => void;
  openSections: Record<string, Record<string, boolean>>;
  saveStatus: 'idle' | 'saving' | 'saved' | 'error';
  selectedSettingsItem: string;
  toggleSection: (tab: string, section: string) => void;
}

export default function LeftSidebar({
  activeTab,
  onOpenPlaceholderImages,
  placeholderGalleryCount,
  instanceId,
  isExpanded,
  onSettingsItemSelect,
  onTabChange,
  onToggleExpanded,
  openSections,
  saveStatus,
  selectedSettingsItem,
  toggleSection,
}: LeftSidebarProps) {
  const { currentConfig, currentInstance, updateConfig, updateInstance } = useInstance();
  const { isPartner } = useAccountPlan();
  // Keep placeholder UX quiet and deterministic (no nagging toasts).
  useToast();

  const flowEnabled = Boolean((currentConfig as any)?.form_status_enabled);
  const hasPlaceholderCount = typeof placeholderGalleryCount === "number";
  const placeholderCount = Number(placeholderGalleryCount ?? 0);
  const hasPlaceholderImages = placeholderCount > 0;

  // Collapsed state
  if (!isExpanded) {
    return (
      <div
        className="flex flex-col border-r border-border/60 bg-card/60 backdrop-blur w-14 transition-all duration-300 shadow-sm"
      >
        <div className="p-3 border-b border-border/50 flex-shrink-0">
          <Button
            variant="ghost"
            size="sm"
            onClick={onToggleExpanded}
            className="w-8 h-8 p-0 hover:bg-accent/60 transition-colors"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        <div className="flex-1 flex flex-col items-center justify-center space-y-4">
          <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
            <Sparkles className="h-4 w-4 text-primary" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="flex flex-col border-r border-border/60 bg-card/60 backdrop-blur w-[420px] h-full min-h-0 transition-all duration-300 shadow-sm"
    >
      {/* Compact Header */}
      <div className="p-3 border-b border-border/60 flex-shrink-0 bg-card/40">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div>
              <h1 className="text-sm font-semibold text-foreground/90 tracking-tight">Design Studio</h1>
            </div>
            <div className="h-4 w-px bg-border/50" />
            <div className="flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full transition-colors ${
                saveStatus === 'saving' ? 'bg-yellow-500 animate-pulse' :
                saveStatus === 'saved' ? 'bg-green-500' :
                saveStatus === 'error' ? 'bg-red-500' : 'bg-muted-foreground/40'
              }`} />
              <span className="text-xs text-muted-foreground font-medium">
                {saveStatus === 'saving' ? 'Saving...' :
                 saveStatus === 'saved' ? 'Saved' :
                 saveStatus === 'error' ? 'Error' : 'Ready'}
              </span>
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={onToggleExpanded}
            className="w-8 h-8 p-0 hover:bg-accent/60 transition-colors"
          >
            {isExpanded ? <ChevronLeft className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </Button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0">
        <div className="p-3 flex flex-col min-h-0 h-full">
          {/* Main Configuration - Clean Tabs */}
          <Tabs value={activeTab} onValueChange={onTabChange} className="w-full h-full flex flex-col min-h-0">
            <div className="mb-3 flex-shrink-0">
              <TabsList className={`grid w-full ${isPartner ? 'grid-cols-2' : 'grid-cols-3'} h-9 bg-muted/50`}>
                {!isPartner && (
                  <TabsTrigger 
                    value="design" 
                    className="flex items-center gap-2 text-xs font-medium px-2 data-[state=active]:bg-background"
                  >
                    <Palette className="h-3 w-3" />
                    Design
                  </TabsTrigger>
                )}
                <TabsTrigger 
                  value="settings" 
                  className="flex items-center gap-2 text-xs font-medium px-2 data-[state=active]:bg-background"
                >
                  <Settings className="h-3 w-3" />
                  Settings
                </TabsTrigger>
                <TabsTrigger 
                  value="launch" 
                  className="flex items-center gap-2 text-xs font-medium px-2 data-[state=active]:bg-background"
                >
                  <Rocket className="h-3 w-3" />
                  Launch
                </TabsTrigger>
              </TabsList>
            </div>
            
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              {!isPartner && (
                <TabsContent value="design" className="mt-0 min-h-0 flex-1 overflow-y-auto pb-24">
                  <div className="space-y-4">
                    <DesignTabV2
                      config={currentConfig as any}
                      updateConfig={updateConfig as any}
                      openSections={openSections}
                      toggleSection={toggleSection}
                    />

                    <details
                      className="group rounded-xl border border-border/60 bg-card/40 shadow-sm hover:bg-muted/20 transition-colors"
                      open={Boolean(openSections.design?.form)}
                    >
                      <summary
                        className="flex items-center justify-between cursor-pointer py-3 px-3 select-none text-foreground/90 hover:bg-muted/30 transition-colors group-open:bg-muted/20"
                        onClick={(e) => {
                          e.preventDefault();
                          toggleSection("design", "form");
                        }}
                      >
                        <span className="flex items-center gap-2.5 text-sm font-medium">
                          <FileText className="h-4 w-4 text-muted-foreground" />
                          Form
                        </span>
                        <ChevronDown
                          className={`h-4 w-4 text-muted-foreground transition-transform duration-200 ${
                            openSections.design?.form ? "rotate-180" : ""
                          }`}
                        />
                      </summary>
                      <div className="py-3 px-3 space-y-4 border-t border-border/50">
                        <div className="space-y-2">
                          <div className="flex items-center justify-between gap-3">
                            <div className="space-y-0.5">
                              <Label className="text-xs font-medium text-foreground/90">Enable form mode</Label>
                              <div className="text-xs text-muted-foreground">Turn on the customer-facing form experience</div>
                            </div>
                            <Switch
                              checked={flowEnabled}
                              onCheckedChange={(checked) => {
                                updateConfig({ form_status_enabled: checked } as any);
                              }}
                            />
                          </div>
                        </div>

                        {flowEnabled ? (
                          <div className="space-y-3 rounded-lg border border-border/50 bg-background/30 p-3">
                            <div className="text-xs font-medium text-foreground/90">Form UI</div>

                            <div className="flex items-center justify-between gap-3">
                              <div className="space-y-0.5">
                                <Label className="text-xs font-medium text-foreground/90">Progress bar</Label>
                              </div>
                              <Switch
                                checked={Boolean((currentConfig as any)?.form_show_progress_bar ?? true)}
                                onCheckedChange={(v) =>
                                  updateConfig({ form_show_progress_bar: v } as any)
                                }
                              />
                            </div>

                            <div className="flex items-center justify-between gap-3">
                              <div className="space-y-0.5">
                                <Label className="text-xs font-medium text-foreground/90">Step descriptions</Label>
                              </div>
                              <Switch
                                checked={Boolean((currentConfig as any)?.form_show_step_descriptions ?? true)}
                                onCheckedChange={(v) =>
                                  updateConfig({ form_show_step_descriptions: v } as any)
                                }
                              />
                            </div>
                          </div>
                        ) : null}

                        {!flowEnabled ? (
                          <div className="space-y-3">
                            <details
                              className="group overflow-hidden rounded-lg border border-border/50 bg-background/30"
                              open={Boolean(openSections.design?.["widget-uploader"])}
                            >
                              <summary
                                className="flex items-center justify-between cursor-pointer px-3 py-2.5 select-none hover:bg-muted/30 transition-colors"
                                onClick={(e) => {
                                  e.preventDefault();
                                  toggleSection("design", "widget-uploader");
                                }}
                              >
                                <span className="flex items-center gap-2 text-sm font-medium text-foreground/90">
                                  <ImageIcon className="h-4 w-4 text-muted-foreground" />
                                  Uploader
                                </span>
                                <ChevronDown
                                  className={`h-4 w-4 text-muted-foreground transition-transform duration-200 ${
                                    openSections.design?.["widget-uploader"] ? "rotate-180" : ""
                                  }`}
                                />
                              </summary>
                              <div className="border-t border-border/30 p-3 space-y-3">
                                <div className="flex items-center justify-between gap-3">
                                  <div className="space-y-0.5">
                                    <Label className="text-xs font-medium text-foreground/90">Enabled</Label>
                                    <div className="text-xs text-muted-foreground">Allow image uploads</div>
                                  </div>
                                  <Switch
                                    checked={Boolean((currentConfig as any)?.uploader_enabled)}
                                    onCheckedChange={(v) => updateConfig({ uploader_enabled: v } as any)}
                                  />
                                </div>

                                <NumberInput
                                  label="Max images"
                                  value={Number((currentConfig as any)?.uploader_max_images ?? 1)}
                                  min={0}
                                  max={10}
                                  onChange={(v) => updateConfig({ uploader_max_images: v } as any)}
                                />

                                {/*
                                  Uploader copy (temporarily hidden)
                                  uploader_primary_text / uploader_secondary_text live on config but are not exposed in UI.
                                */}
                              </div>
                            </details>

                            {/*
                              Suggestions (temporarily hidden)
                              We'll re-add this soon.
                            */}

                            <details
                              className="group overflow-hidden rounded-lg border border-border/50 bg-background/30"
                              open={Boolean(openSections.design?.["widget-gallery"])}
                            >
                              <summary
                                className="flex items-center justify-between cursor-pointer px-3 py-2.5 select-none hover:bg-muted/30 transition-colors"
                                onClick={(e) => {
                                  e.preventDefault();
                                  toggleSection("design", "widget-gallery");
                                }}
                              >
                                <span className="flex items-center gap-2 text-sm font-medium text-foreground/90">
                                  <Images className="h-4 w-4 text-muted-foreground" />
                                  Gallery
                                </span>
                                <ChevronDown
                                  className={`h-4 w-4 text-muted-foreground transition-transform duration-200 ${
                                    openSections.design?.["widget-gallery"] ? "rotate-180" : ""
                                  }`}
                                />
                              </summary>
                              <div className="border-t border-border/30 p-3 space-y-3">
                                <div className="grid grid-cols-2 gap-3">
                                  <NumberInput
                                    label="Max Images"
                                    value={Number((currentConfig as any)?.gallery_max_images ?? 4)}
                                    min={0}
                                    max={24}
                                    onChange={(v) => {
                                      const currentColumns = Number((currentConfig as any)?.gallery_columns ?? 2);
                                      const next: any = { gallery_max_images: v };

                                      // Simpler rule: columns only ever 1 or 2, and only makes sense with 2+ images.
                                      if (v < 2) {
                                        next.gallery_columns = 1;
                                      } else if (currentColumns > 2) {
                                        next.gallery_columns = 2;
                                      }

                                      updateConfig(next);
                                    }}
                                  />
                                </div>

                                {Number((currentConfig as any)?.gallery_max_images ?? 4) >= 2 ? (
                                  <div className="flex items-center justify-between gap-3">
                                    <div className="space-y-0.5">
                                      <Label className="text-xs font-medium text-foreground/90">Two columns</Label>
                                      <div className="text-xs text-muted-foreground">Use 2 columns when showing multiple images</div>
                                    </div>
                                    <Switch
                                      checked={Number((currentConfig as any)?.gallery_columns ?? 2) >= 2}
                                      onCheckedChange={(v) => updateConfig({ gallery_columns: v ? 2 : 1 } as any)}
                                      aria-label="Use two columns"
                                    />
                                  </div>
                                ) : null}

                                {onOpenPlaceholderImages ? (
                                  <div className="flex items-center justify-between gap-3 rounded-md border border-border/40 bg-background/40 px-3 py-2">
                                    <div className="space-y-0.5">
                                      <div className="text-xs font-medium text-foreground/90">Placeholder images</div>
                                      <div className="text-xs text-muted-foreground">
                                        Manage the sample gallery shown before generations
                                      </div>
                                    </div>
                                    <div className="flex items-center gap-2">
                                      <Switch
                                        checked={hasPlaceholderImages && Boolean((currentConfig as any)?.gallery_show_placeholder_images)}
                                        onCheckedChange={async (v) => {
                                          if (!v) {
                                            updateConfig({ gallery_show_placeholder_images: false } as any);
                                            return;
                                          }

                                          // Wait for count to be known to avoid blocking when data hasn't loaded yet.
                                          if (!hasPlaceholderCount) return;

                                          // Can't enable until there are images.
                                          if (!hasPlaceholderImages) {
                                            updateConfig({ gallery_show_placeholder_images: false } as any);
                                            onOpenPlaceholderImages?.();
                                            return;
                                          }

                                          updateConfig({ gallery_show_placeholder_images: true } as any);
                                        }}
                                        disabled={!hasPlaceholderCount}
                                        aria-label="Show placeholder images"
                                      />
                                      <Button
                                        type="button"
                                        variant="outline"
                                        className="h-8 px-2 text-xs"
                                        onClick={onOpenPlaceholderImages}
                                      >
                                        {hasPlaceholderImages ? "Manage" : "Generate"}
                                      </Button>
                                    </div>
                                  </div>
                                ) : null}
                              </div>
                            </details>
                          </div>
                        ) : null}

                      </div>
                    </details>

                    {/*
                      Demo Overlay (temporarily hidden)
                      We'll rework this soon.
                    */}

                    <details
                      className="group rounded-xl border border-border/60 bg-card/40 shadow-sm hover:bg-muted/20 transition-colors"
                      open={Boolean(openSections.design?.lead)}
                    >
                      <summary
                        className="flex items-center justify-between cursor-pointer py-3 px-3 select-none text-foreground/90 hover:bg-muted/30 transition-colors group-open:bg-muted/20"
                        onClick={(e) => {
                          e.preventDefault();
                          toggleSection("design", "lead");
                        }}
                      >
                        <span className="flex items-center gap-2.5 text-sm font-medium">
                          <Mail className="h-4 w-4 text-muted-foreground" />
                          Lead Capture
                        </span>
                        <ChevronDown
                          className={`h-4 w-4 text-muted-foreground transition-transform duration-200 ${
                            openSections.design?.lead ? "rotate-180" : ""
                          }`}
                        />
                      </summary>
                      <div className="py-3 px-3 space-y-4 border-t border-border/50">
                        <div className="flex items-center justify-between gap-3">
                          <div className="space-y-0.5">
                            <Label className="text-xs font-medium text-foreground/90">Enabled</Label>
                            <div className="text-xs text-muted-foreground">Collect email/name/phone in a modal</div>
                          </div>
                          <Switch
                            checked={Boolean((currentConfig as any)?.lead_capture_enabled)}
                            onCheckedChange={(v) => updateConfig({ lead_capture_enabled: v } as any)}
                          />
                        </div>
                      </div>
                    </details>
                  </div>
                </TabsContent>
              )}
              
              <TabsContent value="settings" className="mt-0 min-h-0 flex-1 overflow-y-auto pb-24">
                <SettingsTab 
                  instance={currentInstance}
                  updateInstance={updateInstance}
                  openSections={openSections}
                  toggleSection={toggleSection}
                  selectedItem={selectedSettingsItem}
                  onItemSelect={onSettingsItemSelect}
                />
              </TabsContent>
              
              <TabsContent value="launch" className="mt-0 min-h-0 flex-1 overflow-y-auto pb-24">
                <LaunchTab 
                  instanceId={instanceId}
                  config={currentConfig}
                  updateConfig={updateConfig}
                  openSections={openSections}
                  toggleSection={toggleSection}
                />
              </TabsContent>
            </div>
          </Tabs>
        </div>
      </div>
    </div>
  );
} 
