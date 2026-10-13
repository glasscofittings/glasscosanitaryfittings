"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchIGPsWithParties, fetchParties, type InwardGatePass } from "@/lib/supabase/procurement";
import IGPTable from "@/components/modules/procurement/IGPTable";
import MaterialIntakeDrawer from "@/components/modules/procurement/MaterialIntakeDrawer";
import { exportGatePassesToPDF } from "@/lib/pdf-exporter";

export default function ProcurementPage() {
  const queryClient = useQueryClient();
  const [newIGPOpen, setNewIGPOpen] = useState(false);

  const { data: igps = [], isSuccess: isLive } = useQuery({
    queryKey: ["igps"],
    queryFn: async () => {
      const res = await fetchIGPsWithParties();
      console.log("React Query [igps] received:", { count: res.length, data: res });
      return res;
    },
    retry: 1,
  });

  const { data: parties = [] } = useQuery({
    queryKey: ["parties"],
    queryFn: async () => {
      const res = await fetchParties();
      console.log("React Query [parties] received:", { count: res.length });
      return res;
    },
    retry: 1,
  });

  async function handleExportPDF() {
    if (igps.length === 0) return;
    await exportGatePassesToPDF(igps, { operatorName: "Gate Supervisor" });
  }

  function handleRefresh() {
    queryClient.invalidateQueries({ queryKey: ["igps"] });
    queryClient.invalidateQueries({ queryKey: ["parties"] });
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-display font-bold tracking-tight">Procurement</h1>
          <p className="text-body text-secondary mt-1">Material Intake & GRN Logistics</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          {isLive && (
            <span className="flex items-center gap-1.5 text-caption text-status-optimal">
              <span className="h-1.5 w-1.5 rounded-full bg-status-optimal animate-pulse" />
              LIVE
            </span>
          )}
          <button
            onClick={handleExportPDF}
            disabled={igps.length === 0}
            title={igps.length === 0 ? "No records to export" : "Export the gate pass table as a PDF"}
            className="h-9 px-3 sm:px-4 rounded-lg bg-bg-muted text-secondary border border-border-default font-medium text-body hover:bg-bg-muted hover:text-foreground disabled:text-disabled disabled:cursor-not-allowed transition-colors flex items-center gap-2"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <span className="hidden xs:inline">Export PDF</span>
          </button>
          <button
            onClick={() => setNewIGPOpen(true)}
            className="h-9 px-4 rounded-lg bg-crimson-primary text-white font-medium text-body hover:bg-crimson-dark transition-colors"
          >
            + New Intake
          </button>
        </div>
      </div>

      <div className="glow-line" />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard label="Pending Inspection" count={igps.filter((i) => i.status === "PENDING_INSPECTION").length} accent="amber" />
        <StatCard label="Converted to GRN" count={igps.filter((i) => i.status === "CONVERTED_TO_GRN").length} accent="green" />
        <StatCard label="Rejected" count={igps.filter((i) => i.status === "REJECTED").length} accent="red" />
      </div>

      <IGPTable igps={igps} parties={parties} onConverted={handleRefresh} />

      {newIGPOpen && (
        <>
          <div className="drawer-overlay" onClick={() => setNewIGPOpen(false)} />
          <div className="drawer-panel" style={{ zIndex: 80 }}>
            <div className="drawer-header">
              <h2 className="text-h2 font-semibold">Material Intake & GRN</h2>
              <button
                onClick={() => setNewIGPOpen(false)}
                className="h-8 w-8 rounded-lg flex items-center justify-center text-muted hover:text-foreground hover:bg-bg-muted transition-colors"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="drawer-body">
              <MaterialIntakeDrawer
                parties={parties}
                onCreated={handleRefresh}
                onClose={() => setNewIGPOpen(false)}
              />
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function StatCard({ label, count, accent }: { label: string; count: number; accent: "amber" | "green" | "red" }) {
  const accentMap = {
    amber: { dot: "bg-status-amber", text: "text-status-amber" },
    green: { dot: "bg-status-optimal", text: "text-status-optimal" },
    red: { dot: "bg-status-alert", text: "text-status-alert" },
  };
  return (
    <div className="glass-card p-4 flex items-center justify-between">
      <div>
        <p className="text-caption text-muted uppercase tracking-wider font-medium">{label}</p>
        <p className={`text-num-kpi font-mono font-bold mt-1 ${accentMap[accent].text}`}>{count}</p>
      </div>
      <span className={`h-2.5 w-2.5 rounded-full ${accentMap[accent].dot}`} />
    </div>
  );
}