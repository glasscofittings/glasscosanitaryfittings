"use client";

import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { useEscapeToClose } from "@/hooks/useEscapeToClose";
import { useDeviceStore } from "@/lib/store/useDeviceStore";
import { useOperatorStore } from "@/lib/store/useOperatorStore";
import { type Party, submitIGP, UOM_OPTIONS, type UOM } from "@/lib/supabase/procurement";
import { generateGRNFromIGP } from "@/lib/supabase/purchase-invoices";
import { formatPKR } from "@/lib/utils/formatters";
import { capitalizeFirst } from "@/lib/utils";

const QTY_EPSILON = 0.0001;

const fmtQty = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 4 });

const intakeSchema = z
  .object({
    supplier_id: z.string().uuid("Select a valid supplier"),
    material_description: z.string().min(1, "Material description is required"),
    uom: z.enum(UOM_OPTIONS),
    gross_weight_kg: z.number().min(0.0001, "Gross weight must be greater than 0"),
    net_weight_kg: z.number().min(0.0001, "Net weight must be greater than 0"),
    unit_price_pkr: z.number().min(0.01, "Unit price must be greater than 0"),
    qc_enabled: z.boolean().default(false),
    accepted_qty: z.number().min(0, "Accepted quantity cannot be negative").default(0),
    rejected_qty: z.number().min(0, "Rejected quantity cannot be negative").default(0),
    rejection_reason: z.string().default(""),
  })
  .superRefine((val, ctx) => {
    if (!val.qc_enabled) return;
    const net = val.net_weight_kg || 0;
    const sum = (val.accepted_qty ?? 0) + (val.rejected_qty ?? 0);
    if (Math.abs(sum - net) > QTY_EPSILON) {
      ctx.addIssue({
        code: "custom",
        path: ["accepted_qty"],
        message: `Accepted + rejected must equal Net Weight (${fmtQty(net)}). Currently ${fmtQty(sum)}.`,
      });
    }
  });

type IntakeFormData = z.infer<typeof intakeSchema>;

interface Props {
  parties: Party[];
  onCreated: () => void;
  onClose: () => void;
}

export default function MaterialIntakeDrawer({ parties: initialParties, onCreated, onClose }: Props) {
  const nodeId = useDeviceStore((s) => s.nodeId);
  const openOperatorModal = useOperatorStore((s) => s.open);
  const queryClient = useQueryClient();

  const [partiesList, setPartiesList] = useState<Party[]>(initialParties);
  const [showAddSupplierModal, setShowAddSupplierModal] = useState(false);
  const [isAddingSupplier, setIsAddingSupplier] = useState(false);
  const [supplierAddError, setSupplierAddError] = useState("");

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors, isSubmitting },
    setError,
    reset,
  } = useForm({
    resolver: zodResolver(intakeSchema),
    defaultValues: {
      supplier_id: "",
      material_description: "",
      uom: "KG",
      gross_weight_kg: undefined,
      net_weight_kg: undefined,
      unit_price_pkr: undefined,
      qc_enabled: false,
      accepted_qty: undefined,
      rejected_qty: 0,
      rejection_reason: "",
    },
  });

  const materialDescField = register("material_description");
  const rejectionReasonField = register("rejection_reason");

  const uom: UOM = watch("uom");
  const qcEnabled = watch("qc_enabled");
  const netWeight = watch("net_weight_kg") || 0;
  const unitPrice = watch("unit_price_pkr") || 0;
  const acceptedQty = watch("accepted_qty") || 0;
  const rejectedQty = watch("rejected_qty") || 0;
  /** Quantity used for valuation: accepted when QC is on, else the full net weight. */
  const billedQty = qcEnabled ? acceptedQty : netWeight;

  // QC on → start by accepting the full net weight; net weight changes → rebalance.
  useEffect(() => {
    if (!qcEnabled) return;
    const net = Number.isFinite(netWeight) ? netWeight : 0;
    setValue("accepted_qty", net, { shouldValidate: true });
    setValue("rejected_qty", 0, { shouldValidate: true });
  }, [netWeight, qcEnabled, setValue]);

  useEscapeToClose(true, onClose);
  useEscapeToClose(showAddSupplierModal, () => setShowAddSupplierModal(false));

  /** Keep accepted + rejected = net weight while typing either quantity. */
  function balanceOnQuantityChange(field: "accepted_qty" | "rejected_qty", raw: string) {
    const entered = Number(raw);
    if (!Number.isFinite(entered)) return;
    const net = Number.isFinite(netWeight) ? netWeight : 0;
    const counterpart = Math.round((net - entered) * 10000) / 10000;
    const target = field === "accepted_qty" ? "rejected_qty" : "accepted_qty";
    setValue(target, counterpart, { shouldValidate: true });
  }

  async function handleCreateSupplier() {
    const name = prompt("Supplier Name:");
    if (!name?.trim()) return;
    const contact_person = prompt("Contact Person:") || "";
    const phone = prompt("Phone:") || "";

    setIsAddingSupplier(true);
    setSupplierAddError("");

    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/parties`, {
        method: "POST",
        headers: {
          apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
          Authorization: `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ""}`,
          "Content-Type": "application/json",
          Prefer: "return=representation",
        },
        body: JSON.stringify({
          name: name.trim(),
          party_type: "SUPPLIER",
          phone: phone.trim() || null,
          address: contact_person.trim() ? `Contact: ${contact_person.trim()}` : null,
        }),
      });

      if (!res.ok) throw new Error("Failed to create supplier");
      const data = await res.json();
      const newSupplier = data[0];

      if (newSupplier) {
        setPartiesList((prev) => [...prev, newSupplier]);
        setValue("supplier_id", newSupplier.id, { shouldValidate: true });
        setShowAddSupplierModal(false);
      } else {
        setSupplierAddError("Failed to insert supplier");
      }
    } catch (err) {
      console.error("Supplier Modal Error:", err);
      setSupplierAddError("An unexpected error occurred while adding supplier");
    } finally {
      setIsAddingSupplier(false);
    }
  }

  async function onSubmit(data: IntakeFormData) {
    let operatorName: string;
    try {
      operatorName = await openOperatorModal(`Submit intake & generate GRN for ${data.material_description}`);
    } catch {
      return;
    }

    try {
      // QC off → everything received is accepted; QC on → explicit split.
      const accepted = data.qc_enabled ? (data.accepted_qty ?? data.net_weight_kg) : data.net_weight_kg;
      const rejected = data.qc_enabled ? (data.rejected_qty ?? 0) : 0;

      // Step 1: Create the IGP record (net weight is equal to accepted weight)
      const igp = await submitIGP({
        supplier_id: data.supplier_id,
        material_description: data.material_description,
        inward_qty: accepted,
        uom: data.uom,
        gross_weight_kg: data.gross_weight_kg,
        net_weight_kg: accepted,
        accepted_qty: accepted,
        rejected_qty: rejected,
        rejection_reason: data.qc_enabled ? data.rejection_reason : null,
        vendor_lot_code: rejected > 0 ? String(rejected) : `LOT-${Date.now()}`,
        coa_code: rejected > 0 ? `REJ:${rejected}` : "",
        device_node: nodeId,
        operator_name: operatorName,
      });

      if (!igp) {
        setError("root", { message: "Failed to create intake record" });
        return;
      }

      // Step 2: Immediately convert to GRN + draft purchase invoice
      const result = await generateGRNFromIGP({
        igp_id: igp.id,
        unit_price: data.unit_price_pkr,
        device_node: nodeId,
        operator_name: operatorName,
      });

      if (result.success) {
        toast.success(`Intake submitted & GRN ${result.grn_number} generated`);
        reset();
        queryClient.invalidateQueries({ queryKey: ["igps"] });
        queryClient.invalidateQueries({ queryKey: ["parties"] });
        onCreated();
        onClose();
      } else {
        setError("root", { message: `IGP created but GRN failed: ${result.error}` });
        toast.warning("IGP created — GRN generation requires manual conversion");
        queryClient.invalidateQueries({ queryKey: ["igps"] });
        onCreated();
        onClose();
      }
    } catch (err) {
      console.error("Intake & GRN Error:", err);
      const detailedMessage = err instanceof Error ? err.message : JSON.stringify(err) || "Unknown error";
      setError("root", { message: `Failed: ${detailedMessage}` });
      toast.error(detailedMessage);
    }
  }

  return (
    <>
      <div className="drawer-overlay" onClick={onClose} />

      <div className="drawer-panel">
        <div className="drawer-header">
          <h2 className="text-h2 font-semibold">Material Intake & GRN</h2>
          <button
            onClick={onClose}
            className="h-8 w-8 rounded-lg flex items-center justify-center text-muted hover:text-foreground hover:bg-bg-muted transition-colors"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="drawer-body">
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-caption text-secondary uppercase tracking-wider font-medium">
                  Supplier *
                </label>
                <button
                  type="button"
                  onClick={() => setShowAddSupplierModal(true)}
                  className="text-xs font-semibold text-crimson-primary hover:underline flex items-center gap-1"
                >
                  + Add New Supplier
                </button>
              </div>

              <select
                {...register("supplier_id")}
                className="w-full h-9 px-3 rounded-lg bg-obsidian-bg border border-border-default text-foreground text-body focus:border-crimson-primary focus:outline-none focus:ring-1 focus:ring-crimson-primary/50 transition-colors"
              >
                <option value="">Select supplier...</option>
                {partiesList.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              {errors.supplier_id && (
                <p className="text-caption text-status-alert mt-1">{errors.supplier_id.message}</p>
              )}
            </div>

            <div>
              <label className="text-caption text-secondary uppercase tracking-wider font-medium block mb-2">
                Material Description *
              </label>
              <input
                type="text"
                {...materialDescField}
                onChange={(e) => {
                  const v = capitalizeFirst(e.target.value);
                  if (v !== e.target.value) e.target.value = v;
                  materialDescField.onChange(e);
                }}
                className="w-full h-9 px-3 rounded-lg bg-obsidian-bg border border-border-default text-foreground text-body focus:border-crimson-primary focus:outline-none focus:ring-1 focus:ring-crimson-primary/50 transition-colors"
                placeholder="e.g. Ceramic Clay White Fine Grade-A"
              />
              {errors.material_description && (
                <p className="text-caption text-status-alert mt-1">{errors.material_description.message}</p>
              )}
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="text-caption text-secondary uppercase tracking-wider font-medium block mb-2">
                  Gross Weight ({uom}) *
                </label>
                <input
                  type="number"
                  step="0.0001"
                  min="0.0001"
                  {...register("gross_weight_kg", { valueAsNumber: true })}
                  className="w-full h-9 px-3 rounded-lg bg-obsidian-bg border border-border-default text-foreground font-mono text-body focus:border-crimson-primary focus:outline-none focus:ring-1 focus:ring-crimson-primary/50 transition-colors"
                  placeholder="0.0000"
                />
                {errors.gross_weight_kg && (
                  <p className="text-caption text-status-alert mt-1">{errors.gross_weight_kg.message}</p>
                )}
              </div>

              <div>
                <label className="text-caption text-secondary uppercase tracking-wider font-medium block mb-2">
                  Net Weight ({uom}) *
                </label>
                <input
                  type="number"
                  step="0.0001"
                  min="0.0001"
                  {...register("net_weight_kg", { valueAsNumber: true })}
                  className="w-full h-9 px-3 rounded-lg bg-obsidian-bg border border-border-default text-foreground font-mono text-body focus:border-crimson-primary focus:outline-none focus:ring-1 focus:ring-crimson-primary/50 transition-colors"
                  placeholder="0.0000"
                />
                {errors.net_weight_kg && (
                  <p className="text-caption text-status-alert mt-1">{errors.net_weight_kg.message}</p>
                )}
              </div>

              <div>
                <label className="text-caption text-secondary uppercase tracking-wider font-medium block mb-2">
                  Unit (UOM) *
                </label>
                <select
                  {...register("uom")}
                  className="w-full h-9 px-2 rounded-lg bg-obsidian-bg border border-border-default text-foreground text-body focus:border-crimson-primary focus:outline-none focus:ring-1 focus:ring-crimson-primary/50 transition-colors"
                >
                  {UOM_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
                {errors.uom && (
                  <p className="text-caption text-status-alert mt-1">{errors.uom.message}</p>
                )}
              </div>
            </div>

            {/* Unit Price */}
            <div>
              <label className="text-caption text-secondary uppercase tracking-wider font-medium block mb-2">
                Unit Price (PKR) *
              </label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                {...register("unit_price_pkr", { valueAsNumber: true })}
                className="w-full h-9 px-3 rounded-lg bg-obsidian-bg border border-border-default text-foreground font-mono text-body focus:border-crimson-primary focus:outline-none focus:ring-1 focus:ring-crimson-primary/50 transition-colors"
                placeholder="0.00"
              />
              {errors.unit_price_pkr && (
                <p className="text-caption text-status-alert mt-1">{errors.unit_price_pkr.message}</p>
              )}
              {unitPrice > 0 && billedQty > 0 && (
                <p className="text-caption text-muted mt-1 font-mono">
                  Total Value ({fmtQty(billedQty)} {uom} accepted): {formatPKR(billedQty * unitPrice)}
                </p>
              )}
            </div>

            {/* Quality Control Toggle */}
            <div className="border border-border-default rounded-lg p-3">
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  {...register("qc_enabled")}
                  className="h-4 w-4 rounded border-border-default text-crimson-primary focus:ring-crimson-primary/50"
                />
                <div>
                  <span className="text-body font-medium text-foreground">Quality Control Inspection</span>
                  <p className="text-caption text-muted">Optional — defaults to accepting full net weight</p>
                </div>
              </label>

              {qcEnabled && (
                <div className="mt-3 space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-caption text-secondary uppercase tracking-wider font-medium block mb-2">
                        Accepted Quantity ({uom})
                      </label>
                      <input
                        type="number"
                        step="0.0001"
                        min="0"
                        max={netWeight}
                        {...register("accepted_qty", {
                          valueAsNumber: true,
                          onChange: (e: { target: { value: string } }) =>
                            balanceOnQuantityChange("accepted_qty", e.target.value),
                        })}
                        className="w-full h-9 px-3 rounded-lg bg-obsidian-bg border border-border-default text-foreground font-mono text-body focus:border-crimson-primary focus:outline-none focus:ring-1 focus:ring-crimson-primary/50 transition-colors"
                        placeholder={netWeight.toString()}
                      />
                      {errors.accepted_qty && (
                        <p className="text-caption text-status-alert mt-1">{errors.accepted_qty.message}</p>
                      )}
                    </div>
                    <div>
                      <label className="text-caption text-secondary uppercase tracking-wider font-medium block mb-2">
                        Rejected Quantity ({uom})
                      </label>
                      <input
                        type="number"
                        step="0.0001"
                        min="0"
                        max={netWeight}
                        {...register("rejected_qty", {
                          valueAsNumber: true,
                          onChange: (e: { target: { value: string } }) =>
                            balanceOnQuantityChange("rejected_qty", e.target.value),
                        })}
                        className="w-full h-9 px-3 rounded-lg bg-obsidian-bg border border-border-default text-foreground font-mono text-body focus:border-crimson-primary focus:outline-none focus:ring-1 focus:ring-crimson-primary/50 transition-colors"
                        placeholder="0"
                      />
                      {errors.rejected_qty && (
                        <p className="text-caption text-status-alert mt-1">{errors.rejected_qty.message}</p>
                      )}
                    </div>
                  </div>
                  <p className="text-caption text-muted">
                    Accepted + rejected must equal Net Weight ({fmtQty(netWeight)} {uom}).
                    {rejectedQty > 0 && <> {fmtQty(rejectedQty)} {uom} will be flagged as rejected.</>}
                  </p>
                  <div>
                    <label className="text-caption text-secondary uppercase tracking-wider font-medium block mb-2">
                      Rejection Reason
                    </label>
                    <textarea
                      {...rejectionReasonField}
                      onChange={(e) => {
                        const v = capitalizeFirst(e.target.value);
                        if (v !== e.target.value) e.target.value = v;
                        rejectionReasonField.onChange(e);
                      }}
                      rows={2}
                      className="w-full px-3 py-2 rounded-lg bg-obsidian-bg border border-border-default text-foreground text-body focus:border-crimson-primary focus:outline-none focus:ring-1 focus:ring-crimson-primary/50 transition-colors resize-none"
                      placeholder="Describe rejection reason (optional)..."
                    />
                  </div>
                </div>
              )}
            </div>

            {errors.root && (
              <p className="text-caption text-status-alert bg-status-alert/10 px-3 py-2 rounded-lg border border-status-alert/30">
                {errors.root.message}
              </p>
            )}

            <div className="flex gap-3 pt-2">
              <button
                type="submit"
                disabled={isSubmitting}
                className="flex-1 h-9 rounded-lg bg-crimson-primary text-white font-medium text-body hover:bg-crimson-dark disabled:bg-bg-muted disabled:text-disabled disabled:cursor-not-allowed transition-colors"
              >
                {isSubmitting ? "Submitting..." : "Submit Intake & Generate GRN"}
              </button>
              <button
                type="button"
                onClick={onClose}
                className="h-9 px-5 rounded-lg bg-bg-muted text-secondary border border-border-default hover:bg-bg-muted transition-colors text-body"
              >
                Cancel
              </button>
            </div>
          </form>

          {showAddSupplierModal && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
              <div className="w-full max-w-sm bg-neutral-900 border border-neutral-800 rounded-2xl p-5 shadow-2xl text-neutral-100 relative">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-base font-bold text-foreground">+ Add New Supplier</h3>
                  <button
                    type="button"
                    onClick={() => setShowAddSupplierModal(false)}
                    className="text-neutral-400 hover:text-neutral-200"
                  >
                    ✕
                  </button>
                </div>

                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-semibold text-neutral-300 uppercase mb-1">
                      Supplier Name *
                    </label>
                    <input
                      type="text"
                      id="supplier-name-input"
                      placeholder="e.g. Hexagon Chemicals Ltd."
                      className="w-full bg-neutral-950 border border-neutral-800 rounded-lg px-3 py-2 text-sm text-neutral-100 focus:outline-none focus:border-crimson-primary"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-neutral-300 uppercase mb-1">
                      Contact Person
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. Tariq Mehmood"
                      className="w-full bg-neutral-950 border border-neutral-800 rounded-lg px-3 py-2 text-sm text-neutral-100 focus:outline-none focus:border-crimson-primary"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-neutral-300 uppercase mb-1">
                      Phone / Mobile
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. +92 300 1234567"
                      className="w-full bg-neutral-950 border border-neutral-800 rounded-lg px-3 py-2 text-sm text-neutral-100 focus:outline-none focus:border-crimson-primary"
                    />
                  </div>

                  {supplierAddError && (
                    <p className="text-xs text-status-alert bg-status-alert/10 p-2 rounded-lg">
                      {supplierAddError}
                    </p>
                  )}

                  <div className="flex items-center justify-end gap-2 pt-2">
                    <button
                      type="button"
                      onClick={() => setShowAddSupplierModal(false)}
                      className="px-3 py-1.5 text-xs text-neutral-400 hover:text-neutral-200"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={handleCreateSupplier}
                      disabled={isAddingSupplier}
                      className="px-4 py-1.5 text-xs font-bold bg-crimson-primary hover:bg-crimson-dark text-white rounded-lg transition-colors"
                    >
                      {isAddingSupplier ? "Saving..." : "Save Supplier"}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}