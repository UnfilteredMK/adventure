import React from 'react';
import { ChevronDown } from 'lucide-react';
import { ColorInput, NumberInput, SelectInput } from '../FormComponents';
import { Switch } from '../../ui/switch';
import { DesignSettings } from '@/types/design';

interface IframeSettingsProps {
  config: DesignSettings;
  isOpen: boolean;
  onToggle: () => void;
  updateConfig: (updates: Partial<DesignSettings>) => void;
}

export const IframeSettings: React.FC<IframeSettingsProps> = ({
  config,
  isOpen,
  onToggle,
  updateConfig,
}) => {
  const iframeBorderEnabled = config.iframe_border !== false;
  return (
    <details 
      className="group overflow-hidden rounded-lg border border-border/40 bg-background/30"
      open={isOpen}
    >
      <summary 
        className="flex items-center justify-between cursor-pointer px-3 py-2.5 select-none hover:bg-muted/30 transition-colors"
        onClick={(e) => {
          e.preventDefault();
          onToggle();
        }}
      >
        <span className="text-sm font-medium text-foreground">Iframe settings</span>
        <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-180" />
      </summary>
      
      {isOpen && (
        <div className="border-t border-border/30">
          <div className="space-y-3 p-4">
            <div className="space-y-3">
              {/* Size */}
              <div className="space-y-2">
                <label className="text-xs font-medium text-muted-foreground">Size</label>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">Width</label>
                    <input
                      type="number"
                      value={config.iframe_width?.replace('px', '') || ''}
                      onChange={(e) => {
                        const value = e.target.value;
                        updateConfig({ iframe_width: value ? `${value}px` : '' });
                      }}
                      onBlur={(e) => {
                        if (!e.target.value) {
                          updateConfig({ iframe_width: '500px' });
                        }
                      }}
                      className="w-full px-2 py-1 text-xs border border-border rounded"
                      min={100}
                      max={2000}
                      placeholder="500 (px)"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">Height</label>
                    <input
                      type="number"
                      value={config.iframe_height?.replace('px', '') || ''}
                      onChange={(e) => {
                        const value = e.target.value;
                        updateConfig({ iframe_height: value ? `${value}px` : '' });
                      }}
                      onBlur={(e) => {
                        if (!e.target.value) {
                          updateConfig({ iframe_height: '600px' });
                        }
                      }}
                      className="w-full px-2 py-1 text-xs border border-border rounded"
                      min={100}
                      max={2000}
                      placeholder="600 (px)"
                    />
                  </div>
                </div>
              </div>

              {/* Style */}
              <div className="space-y-2">
                <label className="text-xs font-medium text-muted-foreground">Style</label>
                <div className="space-y-3">
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">Iframe background</label>
                    <ColorInput
                      label="Color behind the widget in the embed"
                      value={config.background_color || "#ffffff"}
                      onChange={(value) => updateConfig({ background_color: value })}
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs">Border</span>
                    <Switch
                      checked={iframeBorderEnabled}
                      onCheckedChange={(checked) => updateConfig({ iframe_border: checked })}
                    />
                  </div>
                  {iframeBorderEnabled && (
                    <>
                      <div className="space-y-1">
                        <label className="text-xs text-muted-foreground">Border width</label>
                        <NumberInput
                          value={config.iframe_border_width || 1}
                          onChange={(value) => updateConfig({ iframe_border_width: value })}
                          min={0}
                          max={10}
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs text-muted-foreground">Border color</label>
                        <ColorInput
                          label="Border color"
                          value={config.iframe_border_color || '#e5e7eb'}
                          onChange={(value) => updateConfig({ iframe_border_color: value })}
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs text-muted-foreground">Corner radius</label>
                        <NumberInput
                          value={config.iframe_border_radius || 12}
                          onChange={(value) => updateConfig({ iframe_border_radius: value })}
                          min={0}
                          max={50}
                        />
                      </div>
                    </>
                  )}
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">Shadow</label>
                    <SelectInput
                      value={(config.iframe_shadow as any) || 'medium'}
                      onChange={(value) => updateConfig({ iframe_shadow: value as any })}
                      options={[
                        { label: 'None', value: 'none' },
                        { label: 'Subtle', value: 'subtle' },
                        { label: 'Medium', value: 'medium' },
                        { label: 'Large', value: 'large' },
                        { label: 'Glow', value: 'glow' },
                      ]}
                    />
                  </div>
                </div>
              </div>

              {/* Behavior */}
              <div className="space-y-2">
                <label className="text-xs font-medium text-muted-foreground">Behavior</label>
                <div className="space-y-2">
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">Loading</label>
                    <SelectInput
                      value={config.iframe_loading || 'lazy'}
                      onChange={(value) => updateConfig({ iframe_loading: value as any })}
                      options={[
                        { label: 'Lazy', value: 'lazy' },
                        { label: 'Eager', value: 'eager' }
                      ]}
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">Scrolling</label>
                    <SelectInput
                      value={config.iframe_scrolling || 'auto'}
                      onChange={(value) => updateConfig({ iframe_scrolling: value as any })}
                      options={[
                        { label: 'Auto', value: 'auto' },
                        { label: 'Yes', value: 'yes' },
                        { label: 'No', value: 'no' }
                      ]}
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs">Allow transparency</span>
                    <Switch
                      checked={config.iframe_allowtransparency !== false}
                      onCheckedChange={(checked) => updateConfig({ iframe_allowtransparency: checked })}
                    />
                  </div>
                </div>
              </div>

              {/* Security */}
              <div className="space-y-2">
                <label className="text-xs font-medium text-muted-foreground">Security</label>
                <div className="space-y-2">
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">Sandbox</label>
                    <input
                      type="text"
                      value={config.iframe_sandbox || 'allow-scripts allow-same-origin allow-forms'}
                      onChange={(e) => updateConfig({ iframe_sandbox: e.target.value })}
                      className="w-full px-2 py-1 text-xs border border-border rounded"
                      placeholder="allow-scripts allow-same-origin allow-forms"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">Referrer policy</label>
                    <SelectInput
                      value={config.iframe_referrerpolicy || 'strict-origin-when-cross-origin'}
                      onChange={(value) => updateConfig({ iframe_referrerpolicy: value })}
                      options={[
                        { label: 'No Referrer', value: 'no-referrer' },
                        { label: 'No Referrer When Downgrade', value: 'no-referrer-when-downgrade' },
                        { label: 'Origin', value: 'origin' },
                        { label: 'Origin When Cross Origin', value: 'origin-when-cross-origin' },
                        { label: 'Strict Origin', value: 'strict-origin' },
                        { label: 'Strict Origin When Cross Origin', value: 'strict-origin-when-cross-origin' },
                        { label: 'Unsafe URL', value: 'unsafe-url' }
                      ]}
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </details>
  );
};
