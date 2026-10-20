/**
 * Predefined sanitary-fitting options that power the searchable dropdowns in the
 * Add / Edit Product modals. All three fields are stored as plain TEXT in the
 * `sanitary_products` table, so the "+ Add Custom" option can still persist a
 * value outside these lists without any schema change.
 */

export const SANITARY_CATEGORY_OPTIONS = [
  "Bath Set Deluxe",
  "Bath Set Economy",
  "Bath Accessories",
] as const;

export type SanitaryCategory = (typeof SANITARY_CATEGORY_OPTIONS)[number];

export const SANITARY_SUBCATEGORY_OPTIONS = [
  "Lever Set Complete",
  "Head Set Complete",
  "Wall Shower 2 Knob",
  "Single Lever Basin Mixer",
  "Double bib Cock",
  "Tee Stop Cock",
  "Brass Waste",
  "Toilet Shower Complete",
  "Toilet Shower Without Pipes",
  "CP Chain",
  "Masjid Mixer",
  "Basin Mixer Cast Neck",
  "Basin Mixer Medium Neck",
  "Side Piller Cock Cast Neck",
  "Side Piller Cock Medium Neck",
  "Sink Mixer Cast Neck",
  "Sink Mixer Medium Neck",
  "Wall Sink Cock Cast Neck",
  "Wall Sink Medium Neck",
  "Bolan Sink Mixer Cast Neck & Long Neck",
  "Rico Single Lever Sink Mixer",
  "Lever Vanity Nova",
  "Long Basin Mixer",
  "Bib Cock",
  "Bib Cock Brass Head",
  "Bib Cock 605-606 C",
  "Long Bib Cock",
  "Nozel Cock",
  "T-Arm",
  "Cp Nipple",
  "Spindle Complete",
  "Goda Jori",
  "Floor Waste",
  "Jet Shower",
  "Complete Concealed",
  "Concealed Mixer",
] as const;

export type SanitarySubcategory = (typeof SANITARY_SUBCATEGORY_OPTIONS)[number];

export const PRODUCT_FINISH_OPTIONS = [
  "Chrome",
  "Gold",
  "Black & Gold",
  "Black",
  "White",
  "Ivory",
  "Grey",
  "Pink",
  "Sky Blue",
] as const;

export type ProductFinish = (typeof PRODUCT_FINISH_OPTIONS)[number];

export interface SanitaryProduct {
  id: string;
  sku: string;
  name: string;
  /** Predefined category, or a custom value added through the dropdown. */
  category: string;
  /** Predefined subcategory, or a custom value added through the dropdown. */
  subcategory?: string;
  /** Predefined finish, or a custom value added through the dropdown. */
  finish?: string;
  material?: string;
  unit_price: number;
  total_stock: number;
  available_stock: number;
  reorder_level: number;
  created_at: string;
}

export type StockAlertLevel = "CRITICAL_LOW" | "REORDER_SOON" | "IN_STOCK";

export interface StockAlert {
  product_id: string;
  product_name: string;
  sku: string;
  available_stock: number;
  reorder_level: number;
  alert_level: StockAlertLevel;
}

export interface ProductDelivery {
  id: string;
  product_id: string;
  quantity_delivered: number;
  customer_name: string;
  delivery_destination: string | null;
  delivery_chalan: string | null;
  remarks: string | null;
  created_at: string;
}

