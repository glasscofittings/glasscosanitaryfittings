"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useEscapeToClose } from "@/hooks/useEscapeToClose";
import { updateSanitaryProduct } from "@/lib/supabase/catalog";
import type { SanitaryProduct } from "@/types";
import {
  SANITARY_CATEGORY_OPTIONS,
  SANITARY_SUBCATEGORY_OPTIONS,
  PRODUCT_FINISH_OPTIONS,
} from "@/types";
import ProductOptionCombobox from "@/components/ui/ProductOptionCombobox";
import { capitalizeFirst } from "@/lib/utils";

interface Props {
  product: SanitaryProduct;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  categoryOptions?: readonly string[];
  subcategoryOptions?: readonly string[];
  finishOptions?: readonly string[];
}

const inputCls =
  "w-full h-9 px-3 rounded-lg bg-obsidian-bg border border-border-default text-foreground text-body focus:border-crimson-primary focus:outline-none focus:ring-1 focus:ring-crimson-primary/50 transition-colors";
const labelCls = "text-caption text-secondary uppercase tracking-wider font-medium block mb-2";

export default function EditProductModal({ product, open, onClose, onSaved, categoryOptions, subcategoryOptions, finishOptions }: Props) {
  const queryClient = useQueryClient();

  const [name, setName] = useState(product.name);
  const [sku, setSku] = useState(product.sku);
  const [category, setCategory] = useState(product.category);
  const [subcategory, setSubcategory] = useState(product.subcategory ?? "");
  const [finish, setFinish] = useState(product.finish ?? "Chrome");
  const [unitPrice, setUnitPrice] = useState(String(product.unit_price));
  const [reorderLevel, setReorderLevel] = useState(String(product.reorder_level));
  const [availableStock, setAvailableStock] = useState(String(product.available_stock));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEscapeToClose(open, onClose);

  if (!open) return null;

  const isValid =
    name.trim() &&
    sku.trim() &&
    category.trim() &&
    subcategory.trim() &&
    finish.trim() &&
    parseFloat(unitPrice) >= 0 &&
    parseInt(reorderLevel) >= 0 &&
    parseInt(availableStock) >= 0;

  async function handleSubmit() {
    if (!isValid) return;
    setSubmitting(true);
    setError("");

    const ok = await updateSanitaryProduct(product.id, {
      sku: sku.trim(),
      name: name.trim(),
      category: category.trim(),
      subcategory: subcategory.trim() || undefined,
      finish: finish.trim() || undefined,
      unit_price: parseFloat(unitPrice) || 0,
      reorder_level: parseInt(reorderLevel) || 0,
      available_stock: parseInt(availableStock) || 0,
      total_stock: parseInt(availableStock) || 0,
    });

    setSubmitting(false);
    if (ok) {
      await queryClient.invalidateQueries({ queryKey: ["sanitary_products"] });
      await queryClient.invalidateQueries({ queryKey: ["inventory"] });
      onSaved();
      onClose();
    } else {
      setError("Failed to update product. Check connection or duplicate SKU.");
    }
  }

  return (
    <>
      <div className="fixed inset-0 z-[80] bg-black/75 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed inset-0 z-[90] flex items-center justify-center p-4">
        <div className="glass-card w-full max-w-lg max-h-[90vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-between p-5 border-b border-border-subtle shrink-0">
            <div>
              <h2 className="text-h2 font-semibold">Edit Product</h2>
              <p className="text-caption text-muted mt-0.5 font-mono">{product.sku}</p>
            </div>
            <button onClick={onClose} className="h-8 w-8 rounded-lg flex items-center justify-center text-muted hover:text-foreground hover:bg-bg-muted transition-colors">
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div className="p-5 space-y-4 overflow-y-auto flex-1">
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2">
                <label className={labelCls}>Product Name</label>
                <input type="text" value={name} onChange={(e) => setName(capitalizeFirst(e.target.value))} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>SKU Code</label>
                <input type="text" value={sku} onChange={(e) => setSku(e.target.value)} className={`${inputCls} font-mono`} />
              </div>
              <div>
                <label className={labelCls} htmlFor="edit-product-category">Category</label>
                <ProductOptionCombobox
                  id="edit-product-category"
                  aria-label="Category"
                  value={category}
                  onChange={setCategory}
                  options={categoryOptions ?? SANITARY_CATEGORY_OPTIONS}
                  placeholder="Bath Set Deluxe"
                />
              </div>
              <div>
                <label className={labelCls} htmlFor="edit-product-subcategory">Subcategory</label>
                <ProductOptionCombobox
                  id="edit-product-subcategory"
                  aria-label="Subcategory"
                  value={subcategory}
                  onChange={setSubcategory}
                  options={subcategoryOptions ?? SANITARY_SUBCATEGORY_OPTIONS}
                  placeholder="Lever Set Complete"
                />
              </div>
              <div>
                <label className={labelCls} htmlFor="edit-product-finish">Finish</label>
                <ProductOptionCombobox
                  id="edit-product-finish"
                  aria-label="Finish"
                  value={finish}
                  onChange={setFinish}
                  options={finishOptions ?? PRODUCT_FINISH_OPTIONS}
                  placeholder="Chrome"
                />
              </div>
              <div>
                <label className={labelCls}>Unit Price (PKR)</label>
                <input type="number" step="0.01" min="0" value={unitPrice} onChange={(e) => setUnitPrice(e.target.value)} className={`${inputCls} font-mono`} />
              </div>
              <div>
                <label className={labelCls}>Reorder Level</label>
                <input type="number" step="1" min="0" value={reorderLevel} onChange={(e) => setReorderLevel(e.target.value)} className={`${inputCls} font-mono`} />
              </div>
              <div>
                <label className={labelCls}>Current Stock (QOH)</label>
                <input type="number" step="1" min="0" value={availableStock} onChange={(e) => setAvailableStock(e.target.value)} className={`${inputCls} font-mono`} />
              </div>
            </div>

            {error && (
              <p className="text-caption text-status-alert bg-status-alert/10 px-3 py-2 rounded-lg">{error}</p>
            )}
          </div>

          <div className="p-5 border-t border-border-subtle shrink-0">
            <div className="flex gap-3">
              <button onClick={handleSubmit} disabled={submitting || !isValid} className="flex-1 h-9 rounded-lg bg-crimson-primary text-white font-medium text-body hover:bg-crimson-dark disabled:bg-bg-muted disabled:text-disabled disabled:cursor-not-allowed transition-colors">
                {submitting ? "Saving..." : "Save Changes"}
              </button>
              <button onClick={onClose} className="h-9 px-5 rounded-lg bg-bg-muted text-secondary border border-border-default hover:bg-bg-muted transition-colors text-body">
                Cancel
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
