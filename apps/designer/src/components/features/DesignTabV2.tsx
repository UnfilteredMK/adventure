import React, { useEffect, useMemo } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { ChevronDown, Loader2, Palette, Settings, Upload } from "lucide-react";
import { ColorInput, FontSelector, NumberInput, SelectInput } from "@/components/features/FormComponents";
import type { DesignSettingsV2 } from "@/types/design-v2";
import { designThemes } from "@/types/design";
import { useToast } from "@/hooks/use-toast";
import { useInstance } from "@/contexts/InstanceContext";
import { uploadImage } from "@/config/persistent-image-storage";

function slugifyThemeKey(name: string) {
  return String(name || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

interface DesignTabV2Props {
  config: DesignSettingsV2;
  openSections: Record<string, Record<string, boolean>>;
  toggleSection: (tab: string, section: string) => void;
  updateConfig: (updates: Partial<DesignSettingsV2>) => void;
}

export const DesignTabV2: React.FC<DesignTabV2Props> = React.memo(
  ({ config, openSections, toggleSection, updateConfig }) => {
    const { toast } = useToast();
    const { currentInstance } = useInstance();
    const logoFileInputRef = React.useRef<HTMLInputElement>(null);
    const [isUploadingLogo, setIsUploadingLogo] = React.useState(false);
    const designSections = useMemo(() => openSections.design || {}, [openSections.design]);
    const colorThemeOptions = useMemo(() => {
      return designThemes.map((t) => {
        const key = slugifyThemeKey(t.name);
        const background = t.background_color || "#ffffff";
        const primary = t.submit_button_background_color || t.accent_color || "#3b82f6";
        const secondary = (t as any).secondary_color || t.submit_button_hover_background_color || "#2563eb";
        return { background, key, name: t.name, primary, secondary };
      });
    }, []);

    const selectedThemeKey = config.color_theme && config.color_theme.length > 0 ? config.color_theme : "custom";
    const selectedTheme = colorThemeOptions.find((t) => t.key === selectedThemeKey) || null;

    const sectionClasses =
      "group rounded-xl border border-border/60 bg-card/40 shadow-sm hover:bg-muted/20 transition-colors";
    const sectionSummaryClasses =
      "flex items-center justify-between cursor-pointer py-3 px-3 select-none text-foreground/90 hover:bg-muted/30 transition-colors group-open:bg-muted/20";
    const sectionContentClasses = "py-3 px-3 space-y-4 border-t border-border/50";

    // For now we only support a single layout: prompt-bottom.
    // Keep the UI simple and force configs back to this value.
    const effectiveLayoutMode = useMemo(() => "prompt-bottom" as const, []);

    useEffect(() => {
      if (config.layout_mode !== effectiveLayoutMode) {
        updateConfig({ layout_mode: effectiveLayoutMode });
      }
    }, [config.layout_mode, effectiveLayoutMode, updateConfig]);

    const handleLogoFilePicked = async (file: File) => {
      if (!file) return;
      if (!file.type.startsWith("image/")) {
        toast({ title: "Invalid file", description: "Please choose an image file.", variant: "destructive" });
        return;
      }
      if (file.size > 2 * 1024 * 1024) {
        toast({ title: "File too large", description: "Please choose an image under 2MB.", variant: "destructive" });
        return;
      }
      if (!currentInstance?.id) {
        toast({ title: "No instance loaded", description: "Please wait for the instance to load.", variant: "destructive" });
        return;
      }

      setIsUploadingLogo(true);
      try {
        const url = await uploadImage(file, `logos/${currentInstance.id}`);
        updateConfig({ logo_enabled: true, logo_url: url });
        toast({ title: "Logo uploaded", description: "Your logo has been updated." });
      } catch (e: any) {
        toast({
          title: "Upload failed",
          description: e?.message ? String(e.message) : "Could not upload your logo.",
          variant: "destructive",
        });
      } finally {
        setIsUploadingLogo(false);
        if (logoFileInputRef.current) logoFileInputRef.current.value = "";
      }
    };

    return (
      <div className="space-y-4 pt-3">
        <details className={sectionClasses} open={designSections["colors"]}>
          <summary
            className={sectionSummaryClasses}
            onClick={(e) => {
              e.preventDefault();
              toggleSection("design", "colors");
            }}
          >
            <span className="flex items-center gap-2.5 text-sm font-medium">
              <Palette className="h-4 w-4 text-muted-foreground" />
              Colors & Typography
            </span>
            <ChevronDown
              className={`h-4 w-4 text-muted-foreground transition-transform duration-200 ${
                designSections["colors"] ? "rotate-180" : ""
              }`}
            />
          </summary>
          <div className={sectionContentClasses}>
            <div className="space-y-2">
              <Label className="text-xs font-medium text-foreground/90">Theme</Label>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    className="w-full justify-between h-9 px-2 text-left text-xs font-normal"
                    aria-label="Select color theme preset"
                    title="Select color theme preset"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="flex gap-1">
                        <div className="h-3 w-3 rounded-full border border-border" style={{ backgroundColor: config.background_color }} />
                        <div className="h-3 w-3 rounded-full border border-border" style={{ backgroundColor: config.primary_color }} />
                        <div className="h-3 w-3 rounded-full border border-border" style={{ backgroundColor: config.secondary_color }} />
                      </div>
                      <span className="min-w-0 flex-1 truncate text-foreground/90">
                        {selectedTheme ? selectedTheme.name : "Custom"}
                      </span>
                    </div>
                    <ChevronDown className="h-4 w-4 text-muted-foreground" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="w-56 max-h-80 overflow-y-auto">
                  <DropdownMenuItem
                    className="h-auto cursor-pointer p-2"
                    onClick={() => updateConfig({ color_theme: "custom" })}
                  >
                    <div className="flex w-full items-center gap-2">
                      <div className="flex gap-1">
                        <div
                          className="h-3 w-3 rounded-full border border-border"
                          style={{ backgroundColor: config.primary_color }}
                        />
                        <div
                          className="h-3 w-3 rounded-full border border-border"
                          style={{ backgroundColor: config.secondary_color }}
                        />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-xs font-medium">Custom</div>
                      </div>
                    </div>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  {colorThemeOptions.map((theme) => (
                    <DropdownMenuItem
                      key={theme.key}
                      className="h-auto cursor-pointer p-2"
                      onClick={() =>
                        updateConfig({
                          background_color: theme.background,
                          color_theme: theme.key,
                          primary_color: theme.primary,
                          secondary_color: theme.secondary,
                        })
                      }
                    >
                      <div className="flex w-full items-center gap-2">
                        <div className="flex gap-1">
                          <div
                            className="h-3 w-3 rounded-full border border-border"
                            style={{ backgroundColor: theme.primary }}
                          />
                          <div
                            className="h-3 w-3 rounded-full border border-border"
                            style={{ backgroundColor: theme.secondary }}
                          />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="text-xs font-medium">{theme.name}</div>
                        </div>
                      </div>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <ColorInput
                label="Primary Color"
                value={config.primary_color}
                onChange={(v) => updateConfig({ color_theme: "custom", primary_color: v })}
              />
              <ColorInput
                label="Secondary Color"
                value={config.secondary_color}
                onChange={(v) => updateConfig({ color_theme: "custom", secondary_color: v })}
              />
            </div>

            <ColorInput
              label="Background Color"
              value={config.background_color}
              onChange={(v) => updateConfig({ background_color: v })}
            />

            <div className="grid grid-cols-2 gap-3">
              <FontSelector
                label="Font Family"
                value={config.font_family}
                onChange={(v) => updateConfig({ font_family: v })}
              />
              <NumberInput
                label="Base Font Size"
                value={config.base_font_size}
                min={10}
                max={40}
                onChange={(v) => updateConfig({ base_font_size: v })}
                unit="px"
              />
            </div>
          </div>
        </details>

        <details className={sectionClasses} open={designSections["branding"]}>
          <summary
            className={sectionSummaryClasses}
            onClick={(e) => {
              e.preventDefault();
              toggleSection("design", "branding");
            }}
          >
            <span className="flex items-center gap-2.5 text-sm font-medium">
              <Settings className="h-4 w-4 text-muted-foreground" />
              Header & Branding
            </span>
            <ChevronDown
              className={`h-4 w-4 text-muted-foreground transition-transform duration-200 ${
                designSections["branding"] ? "rotate-180" : ""
              }`}
            />
          </summary>
          <div className={sectionContentClasses}>
            <div className="flex items-center justify-between gap-3">
              <div className="space-y-0.5">
                <Label className="text-xs font-medium text-foreground/90">Header Enabled</Label>
                <div className="text-xs text-muted-foreground">Show the widget header area</div>
              </div>
              <Switch
                checked={config.header_enabled ?? true}
                onCheckedChange={(v) => updateConfig({ header_enabled: v })}
              />
            </div>

            <SelectInput
              label="Header Alignment"
              value={config.header_alignment}
              onChange={(v) => updateConfig({ header_alignment: v as any })}
              options={[
                { label: "Left", value: "left" },
                { label: "Center", value: "center" },
                { label: "Right", value: "right" },
              ]}
            />

            <div className="flex items-center justify-between gap-3">
              <div className="space-y-0.5">
                <Label className="text-xs font-medium text-foreground/90">Brand Name Enabled</Label>
                <div className="text-xs text-muted-foreground">Show the brand name text</div>
              </div>
              <Switch
                checked={config.brand_name_enabled ?? true}
                onCheckedChange={(v) =>
                  updateConfig(v ? { brand_name_enabled: true, header_enabled: true } : { brand_name_enabled: false })
                }
              />
            </div>

            <div className="space-y-2">
              <Label className="text-xs font-medium text-foreground/90">Brand Name</Label>
              <Input
                value={config.brand_name}
                onChange={(e) => updateConfig({ brand_name: e.target.value })}
                className="h-9 text-xs"
              />
            </div>

            <div className="flex items-center justify-between gap-3">
              <div className="space-y-0.5">
                <Label className="text-xs font-medium text-foreground/90">Logo Enabled</Label>
                <div className="text-xs text-muted-foreground">Show a logo image</div>
              </div>
              <Switch
                checked={config.logo_enabled ?? false}
                onCheckedChange={(v) =>
                  updateConfig(v ? { logo_enabled: true, header_enabled: true } : { logo_enabled: false })
                }
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <NumberInput
                label="Logo Height"
                value={config.logo_height}
                min={16}
                max={200}
                onChange={(v) => updateConfig({ logo_height: v })}
                unit="px"
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <div className="space-y-0.5">
                  <Label className="text-xs font-medium text-foreground/90">Logo file</Label>
                  <div className="text-xs text-muted-foreground">Upload a PNG/JPG/SVG. No URL needed.</div>
                </div>
                {config.logo_url ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-8 px-2 text-xs"
                    onClick={() => updateConfig({ logo_url: "" })}
                    disabled={isUploadingLogo}
                  >
                    Remove
                  </Button>
                ) : null}
              </div>

              <div className="flex items-center gap-3">
                <input
                  ref={logoFileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void handleLogoFilePicked(file);
                  }}
                />
                <Button
                  type="button"
                  variant="outline"
                  className="h-9 px-3 text-xs"
                  onClick={() => logoFileInputRef.current?.click()}
                  disabled={isUploadingLogo}
                >
                  {isUploadingLogo ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      Uploading
                    </>
                  ) : (
                    <>
                      <Upload className="h-4 w-4 mr-2" />
                      Upload logo
                    </>
                  )}
                </Button>

                {config.logo_url ? (
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="h-9 w-9 rounded-md border border-border/60 bg-background/40 overflow-hidden flex items-center justify-center">
                      <img src={config.logo_url} alt="Logo preview" className="h-full w-full object-contain" />
                    </div>
                    <div className="min-w-0 text-xs text-muted-foreground truncate">{config.logo_url}</div>
                  </div>
                ) : (
                  <div className="text-xs text-muted-foreground">No logo uploaded.</div>
                )}
              </div>
            </div>
          </div>
        </details>

        {/*
          Layout (temporarily hidden)
          We’re standardizing on a single layout: prompt-bottom.

          <details className={sectionClasses} open={designSections["layout"]}>
            ...
          </details>
        */}

        {/*
          User Input (temporarily hidden)
          Moved into the Form section of the sidebar and only shown when AI Form is OFF.
        */}

      </div>
    );
  }
);

DesignTabV2.displayName = "DesignTabV2";
