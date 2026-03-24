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
          <div className="space-y-3 p-4">
            <div className="space-y-3">
              {/* Modal Behavior */}
              <div className="space-y-2">
                <label className="text-xs font-medium text-muted-foreground">Interaction</label>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs">Backdrop click closes</span>
                    <Switch
                      checked={config.modal_close_on_backdrop !== false}
                      onCheckedChange={(checked) => updateConfig({ modal_close_on_backdrop: checked })}
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs">Escape closes</span>
                    <Switch
                      checked={config.modal_close_on_escape !== false}
                      onCheckedChange={(checked) => updateConfig({ modal_close_on_escape: checked })}
                    />
                  </div>
                </div>
              </div>

              {/* Modal Styling */}
              <div className="space-y-2">
                <label className="text-xs font-medium text-muted-foreground">Style</label>
                <div className="space-y-3">
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">Backdrop opacity</label>
                    <NumberInput
                      value={config.modal_backdrop_opacity || 0.5}
                      onChange={(value) => updateConfig({ modal_backdrop_opacity: value })}
                      min={0}
                      max={1}
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">Backdrop color</label>
                    <ColorInput
                      label="Backdrop color"
                      value={config.modal_backdrop_color || '#000000'}
                      onChange={(value) => updateConfig({ modal_backdrop_color: value })}
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">Background</label>
                    <ColorInput
                      label="Modal background color"
                      value={config.modal_background_color || '#ffffff'}
                      onChange={(value) => updateConfig({ modal_background_color: value })}
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">Corner radius</label>
                    <NumberInput
                      value={config.modal_border_radius || 12}
                      onChange={(value) => updateConfig({ modal_border_radius: value })}
                      min={0}
                      max={50}
                    />
                  </div>
                </div>
              </div>

              {/* Open/close timing (generated snippet uses a fade transition only) */}
              <div className="space-y-2">
                <label className="text-xs font-medium text-muted-foreground">Transition</label>
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">Duration (ms)</label>
                  <NumberInput
                    value={config.modal_animation_duration || 300}
                    onChange={(value) => updateConfig({ modal_animation_duration: value })}
                    min={100}
                    max={1000}
                  />
                </div>
              </div>

              {/* Modal Size */}
              <div className="space-y-2">
                <label className="text-xs font-medium text-muted-foreground">Size</label>
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <label className="text-xs text-muted-foreground">Width</label>
                      <input
                        type="text"
                        value={config.modal_width || '80%'}
                        onChange={(e) => updateConfig({ modal_width: e.target.value })}
                        className="w-full px-2 py-1 text-xs border border-border rounded"
                        placeholder="80%"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs text-muted-foreground">Height</label>
                      <input
                        type="text"
                        value={config.modal_height || '80%'}
                        onChange={(e) => updateConfig({ modal_height: e.target.value })}
                        className="w-full px-2 py-1 text-xs border border-border rounded"
                        placeholder="80%"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <label className="text-xs text-muted-foreground">Max width</label>
                      <NumberInput
                        value={config.modal_max_width || 600}
                        onChange={(value) => updateConfig({ modal_max_width: value })}
                        min={300}
                        max={1200}
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs text-muted-foreground">Max height</label>
                      <NumberInput
                        value={config.modal_max_height || 800}
                        onChange={(value) => updateConfig({ modal_max_height: value })}
                        min={400}
                        max={1000}
                      />
                    </div>
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
