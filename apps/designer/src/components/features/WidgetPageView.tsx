"use client";

import React from "react";
import { DesignSettings } from "@mage/types";
import IframeWidgetPreview from "./IframeWidgetPreview";

interface WidgetPageViewProps {
  className?: string;
  deployment?: boolean;
  fullPage?: boolean;
  instanceId: string;
  liveConfig?: DesignSettings | null;
  mode?: 'widget' | 'form';
  previewMode?: 'desktop' | 'mobile' | 'iframe';
  style?: React.CSSProperties;
}

const WidgetPageViewComponent: React.FC<WidgetPageViewProps> = ({
  className,
  fullPage = false,
  instanceId,
  liveConfig,
  mode = 'widget',
  previewMode = 'desktop',
  style,
}) => {
  // For fullPage mode, we still use the iframe but with different styling
  if (fullPage) {
    return (
      <IframeWidgetPreview
        instanceId={instanceId}
        liveConfig={liveConfig}
        className={["w-full", "h-full", "min-h-0", className].filter(Boolean).join(" ")}
        fullPage={true}
        previewMode={previewMode}
        mode={mode}
      />
    );
  }

  return (
    <div className={`relative w-full h-full overflow-hidden ${className || ''}`} style={style}>
      <IframeWidgetPreview
        instanceId={instanceId}
        liveConfig={liveConfig}
        fullPage={false}
        previewMode={previewMode}
        mode={mode}
      />
    </div>
  );
};

WidgetPageViewComponent.displayName = 'WidgetPageView';

export const WidgetPageView = React.memo(WidgetPageViewComponent); 
