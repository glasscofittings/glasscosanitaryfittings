import { Suspense } from "react";
import Header from "@/components/header";
import Sidebar from "@/components/sidebar";
import RouteLoadingSkeleton from "@/components/shared/RouteLoadingSkeleton";
import DynamicMainWrapper from "@/components/shared/DynamicMainWrapper";
import AuthGuard from "@/components/shared/AuthGuard";
import ModuleDisabledBanner from "@/components/shared/ModuleDisabledBanner";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGuard>
      <div className="min-h-screen bg-obsidian-bg text-foreground overflow-x-hidden">
        <Header />
        <div className="flex pt-14 min-h-screen overflow-x-hidden">
          <Sidebar />
          <DynamicMainWrapper>
            <ModuleDisabledBanner />
            <Suspense fallback={<RouteLoadingSkeleton />}>
              {children}
            </Suspense>
          </DynamicMainWrapper>
        </div>
      </div>
    </AuthGuard>
  );
}
