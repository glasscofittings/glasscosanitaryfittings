"use client";

import React, { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { Resolver } from "react-hook-form";
import { z } from "zod";
import { toast } from "sonner";
import { Loader2, Package, AlertTriangle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatPKR } from "@/lib/utils/formatters";
import { capitalizeFirst } from "@/lib/utils";

// ── Schema ───────────────────────────────────────────────────────────────────

const issueSchema = z.object({
  lot_id: z.string().min(1, "Material lot is required"),
  issue_qty: z.number().positive("Issue quantity must be greater than 0"),
  batch_order_id: z.string().optional(),
  notes: z.string().optional(),
});

type IssueFormValues = z.infer<typeof issueSchema>;

// ── Types ────────────────────────────────────────────────────────────────────

interface UnrestrictedLot {
  id: string;
  lot_number: string;
  product_name: string;
  remaining_qty: number;
  unit_cost_pkr: number;
  warehouse_code: string;
  vendor_lot_code: string;
  days_until_expiry: number;
}

interface BatchOrder {
  id: string;
  batch_number: string;
  product_name: string;
  status: string;
}

interface ProductionIssueFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onIssued?: () => void;
}

// ── Component ────────────────────────────────────────────────────────────────

export function ProductionIssueForm({
  open,
  onOpenChange,
  onIssued,
}: ProductionIssueFormProps) {
  const [lots, setLots] = useState<UnrestrictedLot[]>([]);
  const [batchOrders, setBatchOrders] = useState<BatchOrder[]>([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    reset,
    formState: { errors },
  } = useForm<IssueFormValues>({
    resolver: zodResolver(issueSchema) as Resolver<IssueFormValues>,
    defaultValues: {
      lot_id: "",
      issue_qty: 0,
      batch_order_id: "",
      notes: "",
    },
  });

  const notesField = register("notes");

  const selectedLotId = watch("lot_id");
  const issueQty = watch("issue_qty");

  const selectedLot = lots.find((l) => l.id === selectedLotId);
  const totalCost = (selectedLot?.unit_cost_pkr ?? 0) * (issueQty ?? 0);

  // ── Fetch unrestricted lots on open ──────────────────────────────────────

  useEffect(() => {
    if (!open) return;

    let cancelled = false;

    async function fetchLots() {
      setLoading(true);
      try {
        const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
        const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
        if (!SUPABASE_URL) return;

        // Query only unrestricted lots with remaining_qty > 0
        const res = await fetch(
          `${SUPABASE_URL}/rest/v1/inventory_lots?status=eq.unrestricted&remaining_qty=gt.0&select=id,lot_number,remaining_qty,unit_cost_pkr,vendor_lot_code,expiration_date,product:products_master(name),warehouse:inventory_warehouses(code)&order=created_at.desc`,
          {
            headers: {
              apikey: SUPABASE_ANON_KEY ?? "",
              Authorization: `Bearer ${SUPABASE_ANON_KEY ?? ""}`,
              "Content-Type": "application/json",
            },
          }
        );

        if (!res.ok || cancelled) return;

        const data = await res.json();
        if (!Array.isArray(data) || cancelled) return;

        const mapped: UnrestrictedLot[] = data.map(
          (row: Record<string, unknown>) => {
            const product = row.product as { name: string } | null;
            const warehouse = row.warehouse as { code: string } | null;
            const expDate = row.expiration_date
              ? new Date(row.expiration_date as string)
              : null;
            const daysUntilExpiry = expDate
              ? Math.ceil(
                  (expDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24)
                )
              : 999;

            return {
              id: row.id as string,
              lot_number: row.lot_number as string,
              product_name: product?.name ?? "Unknown Material",
              remaining_qty: Number(row.remaining_qty) || 0,
              unit_cost_pkr: Number(row.unit_cost_pkr) || 0,
              warehouse_code: warehouse?.code ?? "WH-01",
              vendor_lot_code: (row.vendor_lot_code as string) || "",
              days_until_expiry: daysUntilExpiry,
            };
          }
        );

        if (!cancelled) setLots(mapped);
      } catch (err) {
        console.error("Error fetching unrestricted lots:", err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    // Fetch active batch orders
    async function fetchBatchOrders() {
      try {
        const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
        const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
        if (!SUPABASE_URL) return;

        const res = await fetch(
          `${SUPABASE_URL}/rest/v1/batch_orders?status=eq.ACTIVE&select=id,batch_number,product:products_master(name)&order=created_at.desc`,
          {
            headers: {
              apikey: SUPABASE_ANON_KEY ?? "",
              Authorization: `Bearer ${SUPABASE_ANON_KEY ?? ""}`,
              "Content-Type": "application/json",
            },
          }
        );

        if (!res.ok || cancelled) return;

        const data = await res.json();
        if (!Array.isArray(data) || cancelled) return;

        const mapped: BatchOrder[] = data.map(
          (row: Record<string, unknown>) => {
            const product = row.product as { name: string } | null;
            return {
              id: row.id as string,
              batch_number: row.batch_number as string,
              product_name: product?.name ?? "Unknown",
              status: row.status as string,
            };
          }
        );

        if (!cancelled) setBatchOrders(mapped);
      } catch {
        // Silent fail
      }
    }

    fetchLots();
    fetchBatchOrders();

    return () => {
      cancelled = true;
    };
  }, [open]);

  // ── Submit ───────────────────────────────────────────────────────────────

  const onSubmit = async (values: IssueFormValues) => {
    if (!selectedLot) {
      toast.error("Selected lot not found");
      return;
    }

    setSubmitting(true);
    try {
      const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
      if (!SUPABASE_URL) throw new Error("Server URL is not configured");

      // Re-verify fresh lot stock before deducting to avoid race condition overwrite
      const freshRes = await fetch(
        `${SUPABASE_URL}/rest/v1/inventory_lots?id=eq.${values.lot_id}&select=remaining_qty,status`,
        {
          headers: {
            apikey: SUPABASE_ANON_KEY ?? "",
            Authorization: `Bearer ${SUPABASE_ANON_KEY ?? ""}`,
          },
        }
      );
      if (!freshRes.ok) throw new Error("Failed to verify available stock");
      const freshData = await freshRes.json();
      const freshLot = freshData[0];
      const freshRemaining = Number(freshLot?.remaining_qty) || 0;

      const newRemaining = Math.round((freshRemaining - values.issue_qty) * 10000) / 10000;

      // Deduct stock from the lot (triggers guard_lot_deduction if status != unrestricted)
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/inventory_lots?id=eq.${values.lot_id}`,
        {
          method: "PATCH",
          headers: {
            apikey: SUPABASE_ANON_KEY ?? "",
            Authorization: `Bearer ${SUPABASE_ANON_KEY ?? ""}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            remaining_qty: newRemaining,
          }),
        }
      );

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        const msg = (body as { message?: string }).message ?? res.statusText;
        if (msg.includes("locked")) {
          toast.error(
            `Lot ${selectedLot.lot_number} is locked. Only unrestricted lots can be issued to production.`
          );
        } else {
          toast.error(`Failed to issue material: ${msg}`);
        }
        return;
      }

      // Audit log
      fetch(`${SUPABASE_URL}/rest/v1/system_audit_logs`, {
        method: "POST",
        headers: {
          apikey: SUPABASE_ANON_KEY ?? "",
          Authorization: `Bearer ${SUPABASE_ANON_KEY ?? ""}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          operator_name: "Production",
          action_type: "MATERIAL_ISSUED_TO_PRODUCTION",
          module: "PP",
          details: {
            lot_id: values.lot_id,
            lot_number: selectedLot.lot_number,
            product_name: selectedLot.product_name,
            issue_qty: values.issue_qty,
            unit_cost_pkr: selectedLot.unit_cost_pkr,
            total_cost_pkr: totalCost,
            batch_order_id: values.batch_order_id || null,
            notes: values.notes || null,
          },
        }),
      }).catch(() => {});

      toast.success(
        `Issued ${values.issue_qty} KG of ${selectedLot.product_name} from lot ${selectedLot.lot_number}`
      );

      reset();
      onOpenChange(false);
      onIssued?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to issue material");
    } finally {
      setSubmitting(false);
    }
  };

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Package className="h-5 w-5" />
            Issue Material to Production
          </DialogTitle>
          <DialogDescription>
            Select an unrestricted lot and specify the quantity to issue. Only lots
            with QC status &quot;Passed&quot; and available stock are shown.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
          {/* Lot Selection */}
          <div className="space-y-2">
            <Label>Material Lot *</Label>
            <Select
              value={selectedLotId}
              onValueChange={(val) =>
                setValue("lot_id", val, { shouldValidate: true })
              }
            >
              <SelectTrigger>
                <SelectValue
                  placeholder={
                    loading ? "Loading unrestricted lots..." : "Select a lot"
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {lots.length === 0 && !loading && (
                  <SelectItem value="none" disabled>
                    No unrestricted lots available
                  </SelectItem>
                )}
                {lots.map((lot) => (
                  <SelectItem key={lot.id} value={lot.id}>
                    <div className="flex items-center justify-between w-full gap-4">
                      <span className="font-mono text-sm">{lot.lot_number}</span>
                      <span className="text-xs text-muted-foreground">
                        {lot.product_name} — {lot.remaining_qty} KG available
                      </span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {errors.lot_id && (
              <p className="text-xs text-destructive">{errors.lot_id.message}</p>
            )}
          </div>

          {/* Lot Details (when selected) */}
          {selectedLot && (
            <div className="rounded-md bg-muted/50 p-3 text-sm space-y-1">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Product:</span>
                <span className="font-medium">{selectedLot.product_name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Warehouse:</span>
                <span className="font-medium">{selectedLot.warehouse_code}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Available:</span>
                <span className="font-mono font-medium">
                  {selectedLot.remaining_qty} KG
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Unit Cost:</span>
                <span className="font-mono font-medium">
                  {formatPKR(selectedLot.unit_cost_pkr)}
                </span>
              </div>
              {selectedLot.days_until_expiry < 30 && (
                <div className="flex items-center gap-1 text-amber-600 mt-1">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  <span className="text-xs font-medium">
                    Expires in {selectedLot.days_until_expiry} days
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Issue Qty */}
          <div className="space-y-2">
            <Label htmlFor="issue_qty">Issue Quantity (KG) *</Label>
            <Input
              id="issue_qty"
              type="number"
              step="0.001"
              min="0.001"
              placeholder="0.000"
              {...register("issue_qty", { valueAsNumber: true })}
            />
            {errors.issue_qty && (
              <p className="text-xs text-destructive">
                {errors.issue_qty.message}
              </p>
            )}
            {selectedLot && issueQty > 0 && (
              <p className="text-xs text-muted-foreground">
                Total cost: {formatPKR(totalCost)}
              </p>
            )}
          </div>

          {/* Batch Order (optional) */}
          {batchOrders.length > 0 && (
            <div className="space-y-2">
              <Label>Link to Batch Order</Label>
              <Select
                value={watch("batch_order_id") || ""}
                onValueChange={(val) =>
                  setValue("batch_order_id", val || undefined)
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Optional: link to a batch order" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  {batchOrders.map((bo) => (
                    <SelectItem key={bo.id} value={bo.id}>
                      {bo.batch_number} — {bo.product_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Notes */}
          <div className="space-y-2">
            <Label htmlFor="notes">Notes</Label>
            <Input
              id="notes"
              placeholder="Optional notes for this material issue"
              {...notesField}
              onChange={(e) => {
                const v = capitalizeFirst(e.target.value);
                if (v !== e.target.value) e.target.value = v;
                notesField.onChange(e);
              }}
            />
          </div>

          {/* Submit */}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={submitting || lots.length === 0}
            >
              {submitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Processing...
                </>
              ) : (
                "Issue to Production"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
