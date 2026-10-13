export type SanitaryCategory =
  | "Faucets & Mixers"
  | "Ceramics & Porcelain"
  | "Showers & Accessories"
  | "Piping & Valves";

export type SanitarySubcategory =
  | "Single Lever"
  | "Wall Mounted"
  | "Sensor Taps"
  | "Water Closets"
  | "Wash Basins"
  | "Pedestals"
  | "Bidets"
  | "Rain Showers"
  | "Hand Showers"
  | "Towel Rails"
  | "Drain Grates"
  | "Angle Valves"
  | "Waste Pipes"
  | "Fittings";

export type ProductFinish =
  | "Chrome"
  | "Matte Black"
  | "Brushed Nickel"
  | "Brass"
  | "Ceramic"
  | "White"
  | "Other";

export interface SanitaryProduct {
  id: string;
  sku: string;
  name: string;
  category: SanitaryCategory;
  subcategory?: SanitarySubcategory;
  finish?: ProductFinish;
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

export const SANITARY_CATEGORIES: Record<SanitaryCategory, string[]> = {
  "Faucets & Mixers": ["Single Lever", "Wall Mounted", "Sensor Taps"],
  "Ceramics & Porcelain": ["Water Closets", "Wash Basins", "Pedestals", "Bidets"],
  "Showers & Accessories": ["Rain Showers", "Hand Showers", "Towel Rails", "Drain Grates"],
  "Piping & Valves": ["Angle Valves", "Waste Pipes", "Fittings"],
};

export const PRODUCT_FINISHES: ProductFinish[] = [
  "Chrome",
  "Matte Black",
  "Brushed Nickel",
  "Brass",
  "Ceramic",
  "White",
  "Other",
];
