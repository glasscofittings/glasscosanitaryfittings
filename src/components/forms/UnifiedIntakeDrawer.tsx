"use client";

import React, { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { Resolver } from "react-hook-form";
import { z } from "zod";
import { toast } from "sonner";
import { Loader2, Package, FileText, ArrowRight } from "lucide-react";

import { useEscapeToClose } from "@/hooks/useEscapeToClose";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
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
import { createGRNAndDraftInvoice } from "@/app/actions/grn";
import { capitalizeFirst } from "@/lib/utils";

// ── Schema ───────────────────────────────────────────────────────────────────

const grnSchema = z
  .object({
    supplier_id: z.string().min(1, "Supplier is required"),
    material_name: z.string().min(1, "Material name is required"),
    vendor_lot_number: z.string().min(1, "Vendor lot number is required"),
    coa_code: z.string().optional(),
    gross_weight: z.number().positive("Must be greater than 0"),
    net_weight: z.number().positive("Must be greater than 0"),
    unit_price_pkr: z.number().positive("Must be greater than 0"),
    quality_adjustments: z.boolean().default(false),
    accepted_qty: z.number().min(0, "Cannot be negative"),
    rejected_qty: z.number().min(0, "Cannot be negative"),
  })
  .refine((data) => data.net_weight <= data.gross_weight, {
    message: "Net weight cannot exceed gross weight",
    path: ["net_weight"],
  })
  .refine((data) => data.accepted_qty + data.rejected_qty === data.net_weight, {
    message: "Accepted + rejected qty must equal net weight",
    path: ["accepted_qty"],
  });

type GRNFormValues = z.infer<typeof grnSchema>;

// ── Types ────────────────────────────────────────────────────────────────────

interface Supplier {
  id: string;
  name: string;
  party_type: string;
}

interface UnifiedIntakeDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: () => void;
}

// ── Component ────────────────────────────────────────────────────────────────

export function UnifiedIntakeDrawer({
  open,
  onOpenChange,
  onCreated,
}: UnifiedIntakeDrawerProps) {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    reset,
    formState: { errors },
  } = useForm<GRNFormValues>({
    resolver: zodResolver(grnSchema) as Resolver<GRNFormValues>,
    defaultValues: {
      supplier_id: "",
      material_name: "",
      vendor_lot_number: "",
      coa_code: "",
      gross_weight: 0,
      net_weight: 0,
      unit_price_pkr: 0,
      quality_adjustments: false,
      accepted_qty: 0,
      rejected_qty: 0,
    },
  });

  const materialNameField = register("material_name");

  const netWeight = watch("net_weight");
  const unitPrice = watch("unit_price_pkr");
  const qualityAdjustments = watch("quality_adjustments");

  // Auto-default accepted/rejected when toggle is off
  useEffect(() => {
    if (!qualityAdjustments && netWeight > 0) {
      setValue("accepted_qty", netWeight, { shouldValidate: true });
      setValue("rejected_qty", 0, { shouldValidate: true });
    }
  }, [qualityAdjustments, netWeight, setValue]);

  // Fetch suppliers on open
  useEffect(() => {
    if (!open) return;
    const fetchSuppliers = async () => {
      try {
        const res = await fetch(
          `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/parties?party_type=in.(SUPPLIER,VENDOR,BOTH)&select=id,name,party_type&order=name.asc`,
          {
            headers: {
              apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
              Authorization: `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ""}`,
            },
          }
        );
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data)) setSuppliers(data);
        }
      } catch {
        // Silent fail — suppliers dropdown will be empty
      }
    };
    fetchSuppliers();
  }, [open]);

  useEscapeToClose(open, () => onOpenChange(false));

  const totalValue = Math.round((netWeight || 0) * (unitPrice || 0) * 100) / 100;

  const onSubmit = async (values: GRNFormValues) => {
    setSubmitting(true);
    try {
      const result = await createGRNAndDraftInvoice({
        supplier_id: values.supplier_id,
        material_name: values.material_name,
        vendor_lot_number: values.vendor_lot_number,
        coa_code: values.coa_code ?? "",
        gross_weight: values.gross_weight,
        net_weight: values.net_weight,
        unit_price_pkr: values.unit_price_pkr,
        accepted_qty: values.accepted_qty,
        rejected_qty: values.rejected_qty,
      });

      if (!result.success) {
        toast.error(result.error ?? "Failed to create GRN");
        return;
      }

      toast.success(
        <div className="flex flex-col gap-1">
          <span className="font-semibold">GRN Created Successfully</span>
          <span className="text-sm opacity-80">
            GRN: {result.grn_code} | Invoice: {result.invoice_number}
          </span>
          <span className="text-sm opacity-80">
            Lot: {result.lot_number} | Status: Pending QC Inspection
          </span>
        </div>
      );

      reset();
      onOpenChange(false);
      onCreated?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Unexpected error occurred");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Package className="h-5 w-5" />
            Material Intake & GRN
          </DialogTitle>
          <DialogDescription>
            Record material receipt, generate GRN, and draft a purchase invoice for 3-way matching.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
          {/* ── Section 1: Supplier & Material ──────────────────────────── */}
          <div className="space-y-4">
            <h4 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
              Supplier & Material
            </h4>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="supplier_id">Supplier *</Label>
                <Select
                  value={watch("supplier_id")}
                  onValueChange={(val) => setValue("supplier_id", val, { shouldValidate: true })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select supplier" />
                  </SelectTrigger>
                  <SelectContent>
                    {suppliers.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {errors.supplier_id && (
                  <p className="text-xs text-destructive">{errors.supplier_id.message}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="material_name">Material Name *</Label>
                <Input
                  id="material_name"
                  placeholder="e.g. Ceramic Clay White"
                  {...materialNameField}
                  onChange={(e) => {
                    const v = capitalizeFirst(e.target.value);
                    if (v !== e.target.value) e.target.value = v;
                    materialNameField.onChange(e);
                  }}
                />
                {errors.material_name && (
                  <p className="text-xs text-destructive">{errors.material_name.message}</p>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="vendor_lot_number">Vendor Lot Number *</Label>
                <Input
                  id="vendor_lot_number"
                  placeholder="e.g. VLOT-2026-001"
                  {...register("vendor_lot_number")}
                />
                {errors.vendor_lot_number && (
                  <p className="text-xs text-destructive">{errors.vendor_lot_number.message}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="coa_code">COA Code</Label>
                <Input
                  id="coa_code"
                  placeholder="Certificate of Analysis code"
                  {...register("coa_code")}
                />
              </div>
            </div>
          </div>

          {/* ── Section 2: Weights & Pricing ───────────────────────────── */}
          <div className="space-y-4">
            <h4 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
              Weights & Pricing
            </h4>

            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label htmlFor="gross_weight">Gross Weight (KG) *</Label>
                <Input
                  id="gross_weight"
                  type="number"
                  step="0.001"
                  min="0.001"
                  placeholder="0.000"
                  {...register("gross_weight", { valueAsNumber: true })}
                />
                {errors.gross_weight && (
                  <p className="text-xs text-destructive">{errors.gross_weight.message}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="net_weight">Net Weight (KG) *</Label>
                <Input
                  id="net_weight"
                  type="number"
                  step="0.001"
                  min="0.001"
                  placeholder="0.000"
                  {...register("net_weight", { valueAsNumber: true })}
                />
                {errors.net_weight && (
                  <p className="text-xs text-destructive">{errors.net_weight.message}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="unit_price_pkr">Unit Price (PKR) *</Label>
                <Input
                  id="unit_price_pkr"
                  type="number"
                  step="0.01"
                  min="0.01"
                  placeholder="0.00"
                  {...register("unit_price_pkr", { valueAsNumber: true })}
                />
                {errors.unit_price_pkr && (
                  <p className="text-xs text-destructive">{errors.unit_price_pkr.message}</p>
                )}
              </div>
            </div>

            {/* Total preview */}
            <div className="flex items-center gap-2 rounded-md bg-muted/50 px-3 py-2 text-sm">
              <FileText className="h-4 w-4 text-muted-foreground" />
              <span className="text-muted-foreground">Total Value:</span>
              <span className="font-semibold">
                PKR {totalValue.toLocaleString("en-PK", { minimumFractionDigits: 2 })}
              </span>
            </div>
          </div>

          {/* ── Section 3: Quality Adjustments ─────────────────────────── */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
                Quality Adjustments
              </h4>
              <div className="flex items-center gap-2">
                <Label htmlFor="quality_toggle" className="text-sm text-muted-foreground">
                  Manual Override
                </Label>
                <Switch
                  id="quality_toggle"
                  checked={qualityAdjustments}
                  onCheckedChange={(checked) =>
                    setValue("quality_adjustments", checked, { shouldValidate: true })
                  }
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="accepted_qty">Accepted Qty (KG)</Label>
                <Input
                  id="accepted_qty"
                  type="number"
                  step="0.001"
                  min="0"
                  placeholder="0.000"
                  disabled={!qualityAdjustments}
                  {...register("accepted_qty", { valueAsNumber: true })}
                />
                {errors.accepted_qty && (
                  <p className="text-xs text-destructive">{errors.accepted_qty.message}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="rejected_qty">Rejected Qty (KG)</Label>
                <Input
                  id="rejected_qty"
                  type="number"
                  step="0.001"
                  min="0"
                  placeholder="0.000"
                  disabled={!qualityAdjustments}
                  {...register("rejected_qty", { valueAsNumber: true })}
                />
                {errors.rejected_qty && (
                  <p className="text-xs text-destructive">{errors.rejected_qty.message}</p>
                )}
              </div>
            </div>

            {!qualityAdjustments && netWeight > 0 && (
              <p className="text-xs text-muted-foreground">
                Auto-set: accepted = {netWeight} KG, rejected = 0 KG
              </p>
            )}
          </div>

          {/* ── Submit ─────────────────────────────────────────────────── */}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Processing...
                </>
              ) : (
                <>
                  Create GRN & Draft Invoice
                  <ArrowRight className="ml-2 h-4 w-4" />
                </>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
