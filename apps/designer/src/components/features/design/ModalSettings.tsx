import React from 'react';
import { ChevronDown } from 'lucide-react';
import { ColorInput, NumberInput } from '../FormComponents';
import { Switch } from '../../ui/switch';
import { DesignSettings } from '@/types/design';

interface ModalSettingsProps {
  config: DesignSettings;
  isOpen: boolean;
  onToggle: () => void;
  updateConfig: (updates: Partial<DesignSettings>) => void;
}

export const ModalSettings: React.FC<ModalSettingsProps> = ({
  config,
  isOpen,
  onToggle,
  updateConfig,
}) => {
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
        <span className="text-sm font-medium text-foreground">Popup settings</span>
        <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-180" />
      </summary>
      
      {isOpen && (
        <div className="border-t border-border/30">
          <div className="space-y-4 p-4">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border/30 pb-3">
              <span className="text-xs text-muted-foreground">Embed only</span>
              <div className="flex items-center gap-2">
                <Switch
                  checked={config.modal_close_on_backdrop !== false}
                  onCheckedChange={(checked) => updateConfig({ modal_close_on_backdrop: checked })}
                />
                <span className="text-xs">Backdrop click</span>
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  checked={config.modal_close_on_escape !== false}
                  onCheckedChange={(checked) => updateConfig({ modal_close_on_escape: checked })}
                />
                <span className="text-xs">Escape</span>
              </div>
            </div>

            <div className="space-y-3">
              <div className="space-y-3">
                <label className="text-xs font-medium text-muted-foreground">Style</label>
                <div className="space-y-3">
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">Backdrop opacity</label>
                    <NumberInput
                      value={config.modal_backdrop_opacity ?? 0.5}
                      onChange={(value) => updateConfig({ modal_backdrop_opacity: value })}
                      min={0}
                      max={1}
                      commitOnBlur
                    />
                  </div>
                  <ColorInput
                    label="Backdrop"
                    value={config.modal_backdrop_color || '#000000'}
                    onChange={(value) => updateConfig({ modal_backdrop_color: value })}
                  />
                  <ColorInput
                    label="Panel"
                    value={config.modal_background_color || '#ffffff'}
                    onChange={(value) => updateConfig({ modal_background_color: value })}
                  />
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">Corner radius</label>
                    <NumberInput
                      value={config.modal_border_radius ?? 12}
                      onChange={(value) => updateConfig({ modal_border_radius: value })}
                      min={0}
                      max={50}
                      commitOnBlur
                    />
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-medium text-muted-foreground">Transition</label>
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">Duration (ms)</label>
                  <NumberInput
                    value={config.modal_animation_duration ?? 300}
                    onChange={(value) => updateConfig({ modal_animation_duration: value })}
                    min={100}
                    max={1000}
                    commitOnBlur
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-medium text-muted-foreground">Widget area (px)</label>
                <div className="grid grid-cols-2 gap-2">
                  <NumberInput
                    label="Max width"
                    value={config.modal_max_width ?? 900}
                    onChange={(value) => updateConfig({ modal_max_width: value })}
                    min={200}
                    commitOnBlur
                  />
                  <NumberInput
                    label="Max height"
                    value={config.modal_max_height ?? 900}
                    onChange={(value) => updateConfig({ modal_max_height: value })}
                    min={200}
                    commitOnBlur
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </details>
  );
};
