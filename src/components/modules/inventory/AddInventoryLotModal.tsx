"use client";

import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useEscapeToClose } from "@/hooks/useEscapeToClose";
import {
  type Product,
  fetchProducts,
  fetchWarehouseId,
  insertInventoryLot,
} from "@/lib/supabase/inventory";

interface Props {
  open: boolean;
  warehouseCode: string;
  onClose: () => void;
  onCreated: () => void;
}

export default function AddInventoryLotModal({ open, warehouseCode, onClose, onCreated }: Props) {
  const queryClient = useQueryClient();
  const [products, setProducts] = useState<Product[]>([]);
  const [loadingProducts, setLoadingProducts] = useState(false);

  const [productId, setProductId] = useState("");
  const [lotNumber, setLotNumber] = useState("");
  const [vendorLotCode, setVendorLotCode] = useState("");
  const [qty, setQty] = useState("");
  const [unitCost, setUnitCost] = useState("");
  const [mfgDate, setMfgDate] = useState(new Date().toISOString().slice(0, 10));
  const [expDate, setExpDate] = useState(
    new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  );
  const [qcStatus, setQcStatus] = useState<"PENDING" | "PASSED">("PENDING");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setLoadingProducts(true);
    const itemType = warehouseCode === "WH-01" ? "RAW_MATERIAL" : "FINISHED_GOOD";
    fetchProducts(itemType).then((p) => {
      setProducts(p);
      setLoadingProducts(false);
    });
    return () => {
      setProducts([]);
      setProductId("");
      setLotNumber("");
      setVendorLotCode("");
      setQty("");
      setUnitCost("");
      setError("");
    };
  }, [open, warehouseCode]);

  useEscapeToClose(open, () => onClose());

  if (!open) return null;

  const selectedProduct = products.find((p) => p.id === productId);
  const isValid =
    productId &&
    lotNumber.trim() &&
    qty &&
    parseFloat(qty) > 0 &&
    mfgDate &&
    expDate &&
    new Date(expDate) > new Date(mfgDate);

  async function handleSubmit() {
    if (!isValid) return;
    setSubmitting(true);
    setError("");

    const whId = await fetchWarehouseId(warehouseCode);
    if (!whId) {
      setSubmitting(false);
      setError("Warehouse not found.");
      return;
    }

    const q = parseFloat(qty);

    const result = await insertInventoryLot({
      lot_number: lotNumber.trim(),
      product_id: productId,
      warehouse_id: whId,
      vendor_lot_code: vendorLotCode.trim() || lotNumber.trim(),
      manufacture_date: mfgDate,
      expiration_date: expDate,
      initial_qty: q,
      remaining_qty: q,
      unit_cost_pkr: unitCost ? parseFloat(unitCost) : 0,
      qc_status: qcStatus,
    });

    setSubmitting(false);
    if (result) {
      queryClient.invalidateQueries({ queryKey: ["inventory"] });
      onCreated();
      onClose();
    } else {
      setError("Failed to create lot. Check connection or duplicate lot number.");
    }
  }

  const inputCls =
    "w-full h-9 px-3 rounded-lg bg-obsidian-bg border border-border-default text-foreground text-body focus:border-crimson-primary focus:outline-none focus:ring-1 focus:ring-crimson-primary/50 transition-colors";
  const labelCls = "text-caption text-secondary uppercase tracking-wider font-medium block mb-2";

  return (
    <>
      <div
        className="fixed inset-0 z-[80] bg-black/75 backdrop-blur-sm"
        onClick={() => onClose()}
      />
      <div className="fixed inset-0 z-[90] flex items-center justify-center p-4">
        <div
          className="glass-card w-full max-w-xl max-h-[90vh] flex flex-col overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between p-5 border-b border-border-subtle shrink-0">
            <div>
              <h2 className="text-h2 font-semibold">Add Stock Lot</h2>
              <p className="text-caption text-muted mt-0.5">
                {warehouseCode === "WH-01" ? "Raw Material" : "Finished Goods"} intake
              </p>
            </div>
            <button
              onClick={onClose}
              className="h-8 w-8 rounded-lg flex items-center justify-center text-muted hover:text-foreground hover:bg-bg-muted transition-colors"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div className="p-5 space-y-4 overflow-y-auto flex-1">
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2">
                <label className={labelCls}>Product / Item</label>
                <select
                  value={productId}
                  onChange={(e) => setProductId(e.target.value)}
                  className={inputCls}
                  disabled={loadingProducts}
                >
                  <option value="">{loadingProducts ? "Loading..." : "Select product..."}</option>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.sku || "no SKU"})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className={labelCls}>Lot Number</label>
                <input
                  type="text"
                  value={lotNumber}
                  onChange={(e) => setLotNumber(e.target.value)}
                  className={inputCls}
                  placeholder="LOT-20260913-001"
                />
              </div>

              <div>
                <label className={labelCls}>Supplier Lot Code</label>
                <input
                  type="text"
                  value={vendorLotCode}
                  onChange={(e) => setVendorLotCode(e.target.value)}
                  className={inputCls}
                  placeholder="Optional"
                />
              </div>

              <div>
                <label className={labelCls}>Quantity</label>
                <input
                  type="number"
                  step="0.0001"
                  min="0"
                  value={qty}
                  onChange={(e) => setQty(e.target.value)}
                  className={`${inputCls} font-mono`}
                  placeholder="0.0000"
                />
              </div>

              <div>
                <label className={labelCls}>Unit Cost (PKR)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={unitCost}
                  onChange={(e) => setUnitCost(e.target.value)}
                  className={`${inputCls} font-mono`}
                  placeholder="0.00"
                />
              </div>

              <div>
                <label className={labelCls}>Manufacture Date</label>
                <input
                  type="date"
                  value={mfgDate}
                  onChange={(e) => setMfgDate(e.target.value)}
                  className={inputCls}
                />
              </div>

              <div>
                <label className={labelCls}>Expiry Date</label>
                <input
                  type="date"
                  value={expDate}
                  onChange={(e) => setExpDate(e.target.value)}
                  className={inputCls}
                />
              </div>

              <div className="col-span-2">
                <label className={labelCls}>Initial QC Status</label>
                <div className="flex gap-2">
                  {(["PENDING", "PASSED"] as const).map((status) => (
                    <button
                      key={status}
                      type="button"
                      onClick={() => setQcStatus(status)}
                      className={`px-4 py-2 rounded-lg text-caption font-medium border transition-all ${
                        qcStatus === status
                          ? status === "PASSED"
                            ? "bg-status-optimal/15 text-status-optimal border-status-optimal/30"
                            : "bg-status-amber/15 text-status-amber border-status-amber/30"
                          : "bg-bg-subtle text-secondary border-border-default hover:bg-bg-muted"
                      }`}
                    >
                      {status}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {selectedProduct && (
              <div className="glass-card p-3 text-caption text-muted space-y-1">
                <p>
                  Unit: <span className="text-foreground font-medium">{selectedProduct.unit_of_measure || "KG"}</span>
                </p>
                <p>
                  Category: <span className="text-foreground font-medium">{selectedProduct.category || "—"}</span>
                </p>
              </div>
            )}

            {error && (
              <p className="text-caption text-status-alert bg-status-alert/10 px-3 py-2 rounded-lg">{error}</p>
            )}
          </div>

          <div className="p-5 border-t border-border-subtle shrink-0">
            <div className="flex gap-3">
              <button
                onClick={handleSubmit}
                disabled={submitting || !isValid}
                className="flex-1 h-9 rounded-lg bg-crimson-primary text-white font-medium text-body hover:bg-crimson-dark disabled:bg-bg-muted disabled:text-disabled disabled:cursor-not-allowed transition-colors"
              >
                {submitting ? "Creating..." : "Add Lot"}
              </button>
              <button
                onClick={onClose}
                className="h-9 px-5 rounded-lg bg-bg-muted text-secondary border border-border-default hover:bg-bg-muted transition-colors text-body"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
