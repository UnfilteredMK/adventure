import React, { useState, useEffect, useRef, useCallback } from "react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { ChevronDown } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { fontOptions, fontOptionsArray, loadGoogleFont, getFontsByCategory, fontCategories } from "@mage/types";

// Color presets for the color picker
const colorPresets = [
  '#ffffff', '#f3f4f6', '#e5e7eb', '#d1d5db', '#9ca3af', '#6b7280',
  '#374151', '#1f2937', '#111827', '#000000', '#dc2626', '#ea580c',
  '#d97706', '#ca8a04', '#65a30d', '#16a34a', '#059669', '#0891b2',
  '#0284c7', '#2563eb', '#4f46e5', '#7c3aed', '#a21caf', '#be185d'
];

// Debounce hook for better performance
const useDebounce = (value: any, delay: number) => {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => {
      clearTimeout(handler);
    };
  }, [value, delay]);

  return debouncedValue;
};

// Helper functions for color conversions
const hexToRgb = (hex: string): { r: number; g: number; b: number } | null => {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16)
  } : null;
};

const rgbToHex = (r: number, g: number, b: number): string => {
  return "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
};

const rgbToHsl = (r: number, g: number, b: number): { h: number; s: number; l: number } => {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;

  if (max === min) {
    h = s = 0;
  } else {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h /= 6;
  }

  return { h: h * 360, s: s * 100, l: l * 100 };
};

const hslToRgb = (h: number, s: number, l: number): { r: number; g: number; b: number } => {
  h /= 360;
  s /= 100;
  l /= 100;

  const hue2rgb = (p: number, q: number, t: number): number => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1/6) return p + (q - p) * 6 * t;
    if (t < 1/2) return q;
    if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
    return p;
  };

  let r, g, b;

  if (s === 0) {
    r = g = b = l;
  } else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1/3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1/3);
  }

  return {
    r: Math.round(r * 255),
    g: Math.round(g * 255),
    b: Math.round(b * 255)
  };
};

// Simple Color Input - Real-time updates for designer
export const ColorInput = ({ 
  label, 
  value, 
  onChange,
  showHex = true,
  showOpacity = false,
  className = "" 
}: { 
  label: string;
  value: string;
  onChange: (value: string) => void;
  showHex?: boolean;
  showOpacity?: boolean;
  className?: string;
}) => {
  const [localValue, setLocalValue] = useState(value);
  const [open, setOpen] = useState(false);

  // Parse current color and opacity
  const parseColorValue = (colorValue: string) => {
    if (colorValue.startsWith('rgba(')) {
      const matches = colorValue.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
      if (matches) {
        const [, r, g, b, a] = matches;
        const hex = rgbToHex(parseInt(r), parseInt(g), parseInt(b));
        return { hex, opacity: a ? parseFloat(a) : 1 };
      }
    }
    return { hex: colorValue, opacity: 1 };
  };

  const { hex: currentHex, opacity: currentOpacity } = parseColorValue(localValue);
  const currentRgb = hexToRgb(currentHex);

  // Update local value when prop value changes
  useEffect(() => {
    setLocalValue(value);
  }, [value]);

  const updateColor = (newHex: string, newOpacity: number = currentOpacity) => {
    let newValue: string;
    if (showOpacity && newOpacity < 1) {
      // Convert hex to RGB for rgba format
      const rgb = hexToRgb(newHex);
      if (rgb) {
        newValue = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${newOpacity})`;
      } else {
        newValue = newHex;
      }
    } else {
      newValue = newHex;
    }
    
    setLocalValue(newValue);
    onChange(newValue);
  };

  const handleColorChange = (newColor: string) => {
    updateColor(newColor, currentOpacity);
  };

  const handleOpacityChange = (newOpacity: number) => {
    updateColor(currentHex, newOpacity);
  };

  const handleHexChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const hex = e.target.value;
    if (/^#[0-9A-F]{0,6}$/i.test(hex)) {
      setLocalValue(hex);
      // Immediate update for real-time preview
      if (hex.length === 7) { // Only update when hex is complete
        updateColor(hex, currentOpacity);
      }
    }
  };

  // Get display color (for the color swatch)
  const displayColor = showOpacity && currentOpacity < 1 
    ? `rgba(${hexToRgb(currentHex)?.r || 0}, ${hexToRgb(currentHex)?.g || 0}, ${hexToRgb(currentHex)?.b || 0}, ${currentOpacity})`
    : currentHex;

  return (
    <div className={`space-y-2 ${className}`}>
      <Label className="text-xs font-medium leading-tight break-words text-foreground/90">{label}</Label>
      <div className="flex items-center gap-2">
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label={`${label} color picker`}
              className="w-9 h-9 rounded-md border border-input bg-background shadow-sm relative overflow-hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              {/* Checkerboard pattern for transparency */}
              {showOpacity && currentOpacity < 1 && (
                <div 
                  className="absolute inset-0"
                  style={{
                    backgroundImage: `linear-gradient(45deg, rgba(0,0,0,0.12) 25%, transparent 25%), 
                                     linear-gradient(-45deg, rgba(0,0,0,0.12) 25%, transparent 25%), 
                                     linear-gradient(45deg, transparent 75%, rgba(0,0,0,0.12) 75%), 
                                     linear-gradient(-45deg, transparent 75%, rgba(0,0,0,0.12) 75%)`,
                    backgroundSize: '10px 10px',
                    backgroundPosition: '0 0, 0 5px, 5px -5px, -5px 0px'
                  }}
                />
              )}
              <div className="absolute inset-0" style={{ backgroundColor: displayColor }} />
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-64 p-3">
            <div className="grid grid-cols-6 gap-1.5 mb-3">
              {colorPresets.map((color) => (
                <button
                  key={color}
                  type="button"
                  onClick={() => {
                    handleColorChange(color);
                    setOpen(false);
                  }}
                  className="w-7 h-7 rounded-md border border-border/50 hover:scale-105 transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                  style={{ backgroundColor: color }}
                />
              ))}
            </div>

            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-muted-foreground">Custom Color</Label>
                <input
                  type="color"
                  value={currentHex}
                  onChange={(e) => handleColorChange(e.target.value)}
                  className="w-full h-9 rounded-md border border-input bg-background"
                />
              </div>

              {showOpacity && (
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium text-muted-foreground flex justify-between">
                    <span>Opacity</span>
                    <span>{Math.round(currentOpacity * 100)}%</span>
                  </Label>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.01"
                    value={currentOpacity}
                    onChange={(e) => handleOpacityChange(parseFloat(e.target.value))}
                    style={{
                      background: currentRgb
                        ? `linear-gradient(to right, rgba(${currentRgb.r},${currentRgb.g},${currentRgb.b},0) 0%, rgba(${currentRgb.r},${currentRgb.g},${currentRgb.b},1) 100%)`
                        : undefined
                    }}
                    className="w-full h-2 rounded-full appearance-none cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-background [&::-webkit-slider-thumb]:border [&::-webkit-slider-thumb]:border-border [&::-webkit-slider-thumb]:shadow-sm [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-background [&::-moz-range-thumb]:border [&::-moz-range-thumb]:border-border [&::-moz-range-thumb]:shadow-sm"
                  />
                </div>
              )}
            </div>
          </PopoverContent>
        </Popover>

        {showHex && (
          <Input
            type="text"
            value={showOpacity && currentOpacity < 1 ? localValue : currentHex}
            onChange={handleHexChange}
            placeholder={showOpacity ? "#000000 or rgba(...)" : "#000000"}
            className="h-9 w-24 text-xs font-mono flex-shrink-0"
            maxLength={showOpacity ? 25 : 7}
          />
        )}
      </div>
    </div>
  );
};

// NumberInput Component - Immediate updates for designer (or commitOnBlur to avoid save/preview spam while typing)
export const NumberInput = ({
  label,
  value,
  onChange,
  min,
  max,
  placeholder,
  unit,
  commitOnBlur = false,
}: {
  label?: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  placeholder?: string;
  unit?: string;
  /** When true, only calls onChange on blur (after clamping). Use for min/max fields where partial digits would thrash config. */
  commitOnBlur?: boolean;
}) => {
  const [localValue, setLocalValue] = useState(value.toString());

  // Update local value when prop value changes
  useEffect(() => {
    setLocalValue(value.toString());
  }, [value]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    if (newValue === '' || /^-?\d*\.?\d*$/.test(newValue)) {
      setLocalValue(newValue);

      if (commitOnBlur) {
        return;
      }

      const numValue = parseFloat(newValue);
      if (!isNaN(numValue)) {
        if (min !== undefined && max !== undefined) {
          if (numValue >= min && numValue <= max) {
            onChange(numValue);
          } else if (numValue < min && newValue.length >= min.toString().length) {
            onChange(min);
            setLocalValue(min.toString());
          } else if (numValue > max && newValue.length >= max.toString().length) {
            onChange(max);
            setLocalValue(max.toString());
          } else {
            onChange(numValue);
          }
        } else {
          onChange(numValue);
        }
      }
    }
  };

  const handleBlur = () => {
    const numValue = parseFloat(localValue);

    if (commitOnBlur) {
      if (isNaN(numValue) || localValue.trim() === '') {
        setLocalValue(value.toString());
        return;
      }
      let constrainedValue = numValue;
      if (min !== undefined && numValue < min) {
        constrainedValue = min;
      } else if (max !== undefined && numValue > max) {
        constrainedValue = max;
      }
      setLocalValue(constrainedValue.toString());
      if (constrainedValue !== value) {
        onChange(constrainedValue);
      }
      return;
    }

    if (!isNaN(numValue)) {
      let constrainedValue = numValue;
      if (min !== undefined && numValue < min) {
        constrainedValue = min;
      } else if (max !== undefined && numValue > max) {
        constrainedValue = max;
      }

      if (constrainedValue !== numValue) {
        setLocalValue(constrainedValue.toString());
        onChange(constrainedValue);
      }
    }
  };

  return (
    <div className="space-y-2">
      {label && <Label className="text-xs font-medium leading-tight break-words text-foreground/90">{label}</Label>}
      <div className="relative">
        <Input
          type="text"
          value={localValue}
          onChange={handleChange}
          onBlur={handleBlur}
          min={min}
          max={max}
          placeholder={placeholder}
          className="h-9 pr-8 text-xs"
        />
        {unit && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
            {unit}
          </span>
        )}
      </div>
    </div>
  );
};

// Enhanced Font Selector Component
interface FontSelectorProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
}

export const FontSelector: React.FC<FontSelectorProps> = ({ label, value, onChange }) => {
  const [open, setOpen] = useState(false);

  // Handle font selection
  const handleFontSelect = (fontFamily: string, fontWeight: string) => {
    // Load the Google Font dynamically
    loadGoogleFont(fontFamily);
    
    // Update the configuration
    onChange(fontFamily);
    setOpen(false);
  };

  // Load the current font if not already loaded
  useEffect(() => {
    if (value) {
      const currentFont = fontOptionsArray.find(f => f.value === value);
      if (currentFont) {
        loadGoogleFont(currentFont.value);
      }
    }
  }, [value]);

  // Load fonts on hover for preview
  const handleFontHover = (fontFamily: string, fontWeight: string) => {
    loadGoogleFont(fontFamily);
  };

  return (
    <div className="space-y-2 relative">
      <Label className="text-xs font-medium leading-tight break-words">{label}</Label>
      
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="w-full flex items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-xs h-9 hover:bg-muted/40 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            style={{ fontFamily: value }}
          >
            <span className="truncate" style={{ fontFamily: value }}>{value || "Select font..."}</span>
            <ChevronDown className={`h-3 w-3 ml-2 transition-transform ${open ? 'rotate-180' : ''}`} />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-72 p-1 max-h-64 overflow-y-auto">
          {fontOptionsArray.map((font) => (
            <button
              key={font.value}
              type="button"
              onClick={() => handleFontSelect(font.value, font.weight)}
              onMouseEnter={() => handleFontHover(font.value, font.weight)}
              className={`w-full text-left px-3 py-2 text-xs hover:bg-muted/50 transition-colors flex items-center justify-between rounded-md ${
                value === font.value ? 'bg-muted' : ''
              }`}
              style={{ fontFamily: font.value }}
            >
              <span className="font-medium truncate" style={{ fontFamily: font.value }}>
                {font.label}
              </span>
              <span className="text-base text-muted-foreground ml-2" style={{ fontFamily: font.value }}>
                Aa
              </span>
            </button>
          ))}
        </PopoverContent>
      </Popover>
    </div>
  );
};

// Simple SelectInput Component (for non-fonts) - Immediate updates
export const SelectInput = ({ 
  label, 
  value, 
  onChange, 
  options,
  className = ""
}: {
  label?: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  className?: string;
}) => (
  <div className="space-y-2">
    {label && <Label className="text-xs font-medium leading-tight break-words">{label}</Label>}
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`w-full rounded-md border border-input bg-background px-3 py-1.5 text-xs h-9 ${className}`}
    >
      {options.map(option => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  </div>
);

// TextInput Component - Debounced for typing
export const TextInput = ({ 
  label, 
  value, 
  onChange, 
  placeholder, 
  required = false 
}: { 
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  required?: boolean;
}) => {
  const [localValue, setLocalValue] = useState(value);
  const debouncedValue = useDebounce(localValue, 300); // Keep debouncing for text

  // Update local value when prop value changes
  useEffect(() => {
    setLocalValue(value);
  }, [value]);

  // Call onChange when debounced value changes
  useEffect(() => {
    if (debouncedValue !== value) {
      onChange(debouncedValue);
    }
  }, [debouncedValue, onChange, value]);

  return (
    <div className="space-y-2">
      <Label>{label} {required && <span className="text-red-500">*</span>}</Label>
      <Input
        value={localValue}
        onChange={(e) => setLocalValue(e.target.value)}
        placeholder={placeholder}
        className="h-9"
      />
    </div>
  );
};

// FontFamilySelector - Immediate updates for selection
export const FontFamilySelector = ({ 
  label, 
  value, 
  onChange 
}: { 
  label: string;
  value: string;
  onChange: (value: string) => void;
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [dropdownPosition, setDropdownPosition] = useState<'left' | 'right'>('left');
  const debouncedSearchTerm = useDebounce(searchTerm, 200); // Only debounce search
  const dropdownRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Calculate optimal dropdown position when opening
  useEffect(() => {
    if (isOpen && buttonRef.current) {
      const buttonRect = buttonRef.current.getBoundingClientRect();
      const dropdownWidth = buttonRect.width; // Same width as button
      const viewportWidth = window.innerWidth;
      const sidebarWidth = 320; // w-80 = 320px
      
      // Check if there's enough space to keep it aligned properly
      const spaceOnRight = sidebarWidth - (buttonRect.left + buttonRect.width);
      const spaceOnLeft = buttonRect.left;
      
      // Keep it left-aligned by default since it's w-full, but adjust if needed
      if (spaceOnRight < dropdownWidth && spaceOnLeft >= dropdownWidth) {
        setDropdownPosition('right');
      } else {
        setDropdownPosition('left');
      }
    }
  }, [isOpen]);

  // Load font immediately when selection changes
  useEffect(() => {
    if (value && value !== 'inherit' && value !== 'sans-serif' && value !== 'serif') {
      loadGoogleFont(value);
    }
  }, [value]);

  const handleFontSelect = (fontFamily: string) => {
    onChange(fontFamily); // Immediate update
    setIsOpen(false);
    setSearchTerm("");
    setSelectedCategory(null);
  };

  const getFilteredFonts = () => {
    let fonts = selectedCategory 
      ? fontOptionsArray.filter(font => font.category === selectedCategory)
      : fontOptionsArray;
    
    if (debouncedSearchTerm) {
      fonts = fonts.filter(font => 
        font.value.toLowerCase().includes(debouncedSearchTerm.toLowerCase())
      );
    }
    
    return fonts.slice(0, 20); // Limit to 20 results for performance
  };

  const displayValue = value === 'inherit' ? 'Default' : value;

  return (
    <div className="space-y-2" ref={dropdownRef}>
      <Label>{label}</Label>
      <div className="relative">
        <Button
          ref={buttonRef}
          type="button"
          variant="outline"
          onClick={() => setIsOpen(!isOpen)}
          className="w-full justify-between h-9 text-left font-normal"
          style={{ fontFamily: value !== 'inherit' ? value : 'inherit' }}
        >
          <span className="truncate">{displayValue}</span>
          <ChevronDown className="h-4 w-4 opacity-50" />
        </Button>
        
        {isOpen && (
          <div 
            className={`absolute z-[9999] mt-1 w-full bg-white border border-gray-300 rounded-md shadow-lg max-h-80 overflow-hidden ${
              dropdownPosition === 'right' ? 'right-0' : 'left-0'
            }`}
          >
            {/* Search and Categories */}
            <div className="p-3 border-b border-gray-200 space-y-2">
              <Input
                placeholder="Search fonts..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)} // Debounced via debouncedSearchTerm
                className="h-8 text-sm"
              />
              
              <div className="flex flex-wrap gap-1">
                <button
                  type="button"
                  onClick={() => setSelectedCategory(null)}
                  className={`px-2 py-1 text-xs rounded ${
                    selectedCategory === null 
                      ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-200' 
                      : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
                  }`}
                >
                  All
                </button>
                {fontCategories.slice(1).map((category) => (
                  <button
                    key={category.value}
                    type="button"
                    onClick={() => setSelectedCategory(category.value)}
                    className={`px-2 py-1 text-xs rounded ${
                      selectedCategory === category.value 
                        ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-200' 
                        : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
                    }`}
                  >
                    {category.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Font List */}
            <div className="max-h-48 overflow-y-auto">
              {getFilteredFonts().map((font) => (
                <button
                  key={font.value}
                  type="button"
                  onClick={() => handleFontSelect(font.value)}
                  className={`w-full px-3 py-2 text-left hover:bg-gray-50 ${
                    value === font.value ? 'bg-blue-50 text-blue-700' : 'text-gray-900'
                  }`}
                  style={{ fontFamily: font.value }}
                >
                  {font.label}
                </button>
              ))}
              {getFilteredFonts().length === 0 && (
                <div className="px-3 py-2 text-sm text-gray-500">
                  No fonts found
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

// SearchInput Component - Debounced for search functionality
export const SearchInput = ({ 
  label, 
  value, 
  onChange, 
  placeholder 
}: { 
  label?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) => {
  const [localValue, setLocalValue] = useState(value);
  const debouncedValue = useDebounce(localValue, 300); // Keep debouncing for search

  // Update local value when prop value changes
  useEffect(() => {
    setLocalValue(value);
  }, [value]);

  // Call onChange when debounced value changes
  useEffect(() => {
    if (debouncedValue !== value) {
      onChange(debouncedValue);
    }
  }, [debouncedValue, onChange, value]);

  return (
    <div className="space-y-2">
      {label && <Label>{label}</Label>}
      <Input
        type="search"
        value={localValue}
        onChange={(e) => setLocalValue(e.target.value)}
        placeholder={placeholder}
        className="h-9"
      />
    </div>
  );
}; 
