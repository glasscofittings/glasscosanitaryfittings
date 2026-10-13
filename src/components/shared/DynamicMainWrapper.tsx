"use client";

import React from "react";
import { useSidebar } from "@/components/providers/SidebarContext";

/**
 * DynamicMainWrapper
 * Reactively adjusts the left margin of the main content area
 * based on the sidebar collapsed/expanded state.
 * Transitions are kept in sync with the sidebar's 300ms ease-in-out animation.
 */
export default function DynamicMainWrapper({
  children,
}: {
  children: React.ReactNode;
}) {
  const { isCollapsed } = useSidebar();

  return (
    <main
      className="flex-1 p-3 sm:p-4 md:p-6 transition-[margin-left] duration-300 ease-in-out overflow-x-hidden min-w-0 max-w-full"
      style={{
        marginLeft: "var(--main-margin-left, 0px)",
      }}
    >
      <div className="w-full max-w-7xl mx-auto space-y-6">
        {children}
      </div>
    </main>
  );
}
