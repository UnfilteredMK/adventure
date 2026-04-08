import React from "react";

import "./globals.css";

export default function AdventureLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="h-[100dvh] min-h-[100dvh] w-full overflow-hidden max-sm:overflow-y-auto max-sm:overscroll-y-contain [-webkit-overflow-scrolling:touch]">
      {children}
    </div>
  );
}
