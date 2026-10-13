import React from "react";

export function RouteLoadingSkeleton() {
  return (
    <div className="w-full space-y-6 animate-pulse p-4">
      <div className="flex justify-between items-center">
        <div className="space-y-2">
          <div className="h-8 w-48 bg-neutral-800/60 rounded-xl" />
          <div className="h-4 w-72 bg-neutral-800/40 rounded-lg" />
        </div>
        <div className="h-10 w-32 bg-neutral-800/60 rounded-xl" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="h-24 bg-neutral-900/60 border border-neutral-800 rounded-2xl p-4" />
        <div className="h-24 bg-neutral-900/60 border border-neutral-800 rounded-2xl p-4" />
        <div className="h-24 bg-neutral-900/60 border border-neutral-800 rounded-2xl p-4" />
      </div>

      <div className="h-96 bg-neutral-900/40 border border-neutral-800 rounded-3xl p-6" />
    </div>
  );
}

export default RouteLoadingSkeleton;
