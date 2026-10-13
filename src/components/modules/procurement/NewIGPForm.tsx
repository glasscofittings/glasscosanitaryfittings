"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { type Party, submitIGP, UOM_OPTIONS, type UOM } from "@/lib/supabase/procurement";
import { capitalizeFirst } from "@/lib/utils";

interface Props {
  parties: Party[];
  onCreated: () => void;
  onClose: () => void;
}

export default function NewIGPForm({ parties, onCreated, onClose }: Props) {
  const queryClient = useQueryClient();
  const [supplierId, setSupplierId] = useState("");
  const [description, setDescription] = useState("");
  const [qty, setQty] = useState("");
  const [uom, setUom] = useState<UOM>("KG");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const q = parseFloat(qty);
    if (!supplierId || !description.trim() || !q || q <= 0) {
      setError("All fields are required with valid values.");
      return;
    }
    setSubmitting(true);
    setError("");

    const result = await submitIGP({
      supplier_id: supplierId,
      material_description: description.trim(),
      inward_qty: q,
      uom,
      vendor_lot_code: "LOT-PENDING",
      coa_code: "COA-PENDING",
      device_node: process.env.NEXT_PUBLIC_DEVICE_NODE_ID ?? "PC-01",
      operator_name: "Gate Staff",
    });

    setSubmitting(false);
    if (result) {
      queryClient.invalidateQueries({ queryKey: ["igps"] });
      onCreated();
      onClose();
    } else {
      setError("Failed to create IGP. Check connection.");
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="text-caption text-secondary uppercase tracking-wider font-medium block mb-2">
          Supplier
        </label>
        <select
          value={supplierId}
          onChange={(e) => setSupplierId(e.target.value)}
          className="w-full h-9 px-3 rounded-lg bg-obsidian-bg border border-border-default text-foreground text-body focus:border-crimson-primary focus:outline-none focus:ring-1 focus:ring-crimson-primary/50 transition-colors"
        >
          <option value="">Select supplier...</option>
          {parties.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="text-caption text-secondary uppercase tracking-wider font-medium block mb-2">
          Material Description
        </label>
        <input
          type="text"
          value={description}
          onChange={(e) => setDescription(capitalizeFirst(e.target.value))}
          className="w-full h-9 px-3 rounded-lg bg-obsidian-bg border border-border-default text-foreground text-body focus:border-crimson-primary focus:outline-none focus:ring-1 focus:ring-crimson-primary/50 transition-colors"
          placeholder="e.g. Brass Ingots Grade-A"
        />
      </div>

      <div className="grid grid-cols-[1fr_110px] gap-3">
        <div>
          <label className="text-caption text-secondary uppercase tracking-wider font-medium block mb-2">
            Inward Quantity
          </label>
          <input
            type="number"
            step="0.0001"
            min="0"
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            className="w-full h-9 px-3 rounded-lg bg-obsidian-bg border border-border-default text-foreground font-mono text-body focus:border-crimson-primary focus:outline-none focus:ring-1 focus:ring-crimson-primary/50 transition-colors"
            placeholder="0.0000"
          />
        </div>
        <div>
          <label className="text-caption text-secondary uppercase tracking-wider font-medium block mb-2">
            Unit (UOM)
          </label>
          <select
            value={uom}
            onChange={(e) => setUom(e.target.value as UOM)}
            className="w-full h-9 px-2 rounded-lg bg-obsidian-bg border border-border-default text-foreground text-body focus:border-crimson-primary focus:outline-none focus:ring-1 focus:ring-crimson-primary/50 transition-colors"
          >
            {UOM_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </div>
      </div>

      {error && (
        <p className="text-caption text-status-alert bg-status-alert/10 px-3 py-2 rounded-lg">
          {error}
        </p>
      )}

      <div className="flex gap-3 pt-2">
        <button
          type="submit"
          disabled={submitting}
          className="flex-1 h-9 rounded-lg bg-crimson-primary text-white font-medium text-body hover:bg-crimson-dark disabled:bg-bg-muted disabled:text-disabled disabled:cursor-not-allowed transition-colors"
        >
          {submitting ? "Creating..." : "Create IGP"}
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
  );
}
