// =============================================================================
// MRP II CALCULATION ENGINE — Glassco ERP
// Module: Material Requirements Planning (MRP II)
// =============================================================================

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

function headers(): HeadersInit {
  return {
    apikey: SUPABASE_ANON_KEY ?? "",
    Authorization: `Bearer ${SUPABASE_ANON_KEY ?? ""}`,
    "Content-Type": "application/json",
  };
}

// ── BOM CRUD Interfaces ─────────────────────────────────────────────────────

export interface Product {
  id: string;
  sku: string;
  name: string;
  category: string;
  item_type: "RAW_MATERIAL" | "FINISHED_GOOD";
  unit_of_measure: string;
  minimum_stock_alert: number;
  created_at: string;
}

export interface BillOfMaterial {
  id: string;
  finished_good_id: string;
  version: string;
  is_active: boolean;
  created_at: string;
}

export interface BOMItem {
  id: string;
  bom_id: string;
  raw_material_id: string;
  quantity_required: number;
}

export interface BOMItemWithProduct extends BOMItem {
  products_master?: Product;
}

export interface BOMWithItems extends BillOfMaterial {
  bom_items?: BOMItemWithProduct[];
  finished_good?: Product;
}

export interface SaveBOMPayload {
  finished_good_id: string;
  version: string;
  items: { raw_material_id: string; quantity_required: number }[];
  device_node: string;
  operator_name: string;
}

// ── MRP Calculation Types ────────────────────────────────────────────────────

export interface SalesOrderItem {
  id: string;
  invoice_id: string;
  product_id: string | null;
  product_name: string;
  quantity: number;
  unit_of_measure: string;
  unit_price_pkr: number;
  finished_good?: Product;
}

export interface BOMExplosion {
  finished_good_id: string;
  finished_good_name: string;
  bom_id: string;
  bom_version: string;
  sales_qty: number;
  unit_of_measure: string;
  components: BOMComponent[];
}

export interface BOMComponent {
  raw_material_id: string;
  raw_material_name: string;
  raw_material_sku: string;
  unit_of_measure: string;
  qty_per_unit: number;
  total_required: number;
}

export interface InventorySnapshot {
  product_id: string;
  product_name: string;
  lot_number: string;
  remaining_qty: number;
  unit_cost_pkr: number;
  warehouse_code: string;
  expiration_date: string;
  status: string;
}

export interface MaterialRequirement {
  raw_material_id: string;
  raw_material_name: string;
  raw_material_sku: string;
  unit_of_measure: string;
  total_required: number;
  on_hand_unrestricted: number;
  on_hand_cost_pkr: number;
  net_deficit: number;
  suggested_pr_qty: number;
  safety_stock: number;
  lead_time_days: number;
  estimated_cost_pkr: number;
  consumed_from_lots: LotConsumption[];
  source_finished_goods: string[];
}

export interface LotConsumption {
  lot_id: string;
  lot_number: string;
  warehouse_code: string;
  available_qty: number;
  unit_cost_pkr: number;
  allocated_qty: number;
}

export interface PurchaseRequisition {
  raw_material_id: string;
  raw_material_name: string;
  raw_material_sku: string;
  unit_of_measure: string;
  requisition_qty: number;
  estimated_unit_cost_pkr: number;
  estimated_total_cost_pkr: number;
  suggested_supplier: string;
  priority: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
}

export interface MRPResult {
  sales_order_id: string;
  sales_order_number: string;
  calculated_at: string;
  total_finished_goods: number;
  total_raw_materials: number;
  total_estimated_cost_pkr: number;
  explosions: BOMExplosion[];
  requirements: MaterialRequirement[];
  purchase_requisitions: PurchaseRequisition[];
  summary: {
    items_with_sufficient_stock: number;
    items_with_deficit: number;
    total_deficit_value_pkr: number;
  };
}

// ── BOM CRUD Functions ───────────────────────────────────────────────────────

export async function fetchBOMs(): Promise<BOMWithItems[]> {
  if (!SUPABASE_URL) return [];
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/bill_of_materials?select=*,bom_items(*,products_master(*)),finished_good:products_master(*)}&order=created_at.desc`,
      { headers: headers() }
    );
    if (!res.ok) {
      const res2 = await fetch(
        `${SUPABASE_URL}/rest/v1/bill_of_materials?select=*,bom_items(*,products_master(*))&order=created_at.desc`,
        { headers: headers() }
      );
      if (!res2.ok) return [];
      const data = await res2.json();
      return Array.isArray(data) ? data : [];
    }
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

export async function fetchActiveBOMForProduct(
  productId: string
): Promise<BOMWithItems | null> {
  if (!SUPABASE_URL) return null;
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/bill_of_materials?finished_good_id=eq.${productId}&is_active=eq.true&select=*,bom_items(*,products_master(*))&limit=1`,
      { headers: headers() }
    );
    if (!res.ok) return null;
    const data = await res.json();
    return Array.isArray(data) ? (data[0] ?? null) : null;
  } catch {
    return null;
  }
}

export async function saveBOM(payload: SaveBOMPayload): Promise<BillOfMaterial | null> {
  if (!SUPABASE_URL) return null;
  try {
    // Deactivate existing active BOM for this product
    const existing = await fetchActiveBOMForProduct(payload.finished_good_id);
    if (existing) {
      await fetch(`${SUPABASE_URL}/rest/v1/bill_of_materials?id=eq.${existing.id}`, {
        method: "PATCH",
        headers: headers(),
        body: JSON.stringify({ is_active: false }),
      });
    }

    // Create new BOM
    const bomRes = await fetch(`${SUPABASE_URL}/rest/v1/bill_of_materials`, {
      method: "POST",
      headers: { ...headers(), Prefer: "return=representation" },
      body: JSON.stringify({
        finished_good_id: payload.finished_good_id,
        version: payload.version,
        is_active: true,
      }),
    });

    if (!bomRes.ok) return null;
    const bomRows = await bomRes.json();
    const bom = Array.isArray(bomRows) ? bomRows[0] : bomRows;
    if (!bom?.id) return null;

    // Insert BOM items
    if (payload.items.length > 0) {
      const items = payload.items.map((item) => ({
        bom_id: bom.id,
        raw_material_id: item.raw_material_id,
        quantity_required: item.quantity_required,
      }));

      await fetch(`${SUPABASE_URL}/rest/v1/bom_items`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify(items),
      });
    }

    // Audit log
    fetch(`${SUPABASE_URL}/rest/v1/system_audit_logs`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        operator_name: payload.operator_name,
        action_type: "BOM_SAVED",
        module: "PP",
        details: {
          bom_id: bom.id,
          finished_good_id: payload.finished_good_id,
          version: payload.version,
          item_count: payload.items.length,
        },
      }),
    }).catch(() => {});

    return bom;
  } catch {
    return null;
  }
}

// ── MRP Calculation Engine ───────────────────────────────────────────────────

/**
 * Calculates material requirements for a sales order (invoice).
 *
 * MRP Logic:
 *   1. Fetch sales invoice line items
 *   2. For each finished good, explode its active BOM
 *   3. Query unrestricted inventory lots for each raw component
 *   4. Net requirements: Required Qty - OnHand Unrestricted Stock
 *   5. Generate suggested Purchase Requisitions for deficits
 *
 * @param salesOrderId - UUID of the sales_invoices record
 * @returns MRPResult with full explosion, requirements, and suggested PRs
 */
export async function calculateMaterialRequirements(
  salesOrderId: string
): Promise<MRPResult> {
  if (!SUPABASE_URL) {
    throw new Error("Server URL is not configured");
  }

  // ── 1. Fetch sales invoice with line items ──────────────────────────────
  const invoiceRes = await fetch(
    `${SUPABASE_URL}/rest/v1/sales_invoices?id=eq.${salesOrderId}&select=*,sales_invoice_items(*,products_master(*))`,
    { headers: headers() }
  );

  if (!invoiceRes.ok) {
    throw new Error(`Failed to fetch sales invoice: ${invoiceRes.status}`);
  }

  const invoiceRows = await invoiceRes.json();
  if (!Array.isArray(invoiceRows) || invoiceRows.length === 0) {
    throw new Error(`Sales invoice not found: ${salesOrderId}`);
  }

  const invoice = invoiceRows[0];
  const lineItems: SalesOrderItem[] = (invoice.sales_invoice_items ?? []).map(
    (item: Record<string, unknown>) => ({
      id: item.id as string,
      invoice_id: item.invoice_id as string,
      product_id: (item.product_id as string) ?? null,
      product_name: (item.product_name as string) ?? "",
      quantity: Number(item.quantity) || 0,
      unit_of_measure: (item.unit_of_measure as string) || "L",
      unit_price_pkr: Number(item.unit_price_pkr) || 0,
      finished_good: item.products_master as Product | undefined,
    })
  );

  // ── 2. Explode BOMs for each finished good ──────────────────────────────
  const explosions: BOMExplosion[] = [];

  for (const item of lineItems) {
    if (!item.product_id || item.quantity <= 0) continue;

    const bom = await fetchActiveBOMForProduct(item.product_id);
    if (!bom || !bom.bom_items || bom.bom_items.length === 0) continue;

    const components: BOMComponent[] = bom.bom_items.map(
      (bi: BOMItemWithProduct) => {
        const product = bi.products_master;
        const qtyPerUnit = bi.quantity_required;
        const totalRequired = qtyPerUnit * item.quantity;

        return {
          raw_material_id: bi.raw_material_id,
          raw_material_name: product?.name ?? "Unknown",
          raw_material_sku: product?.sku ?? "",
          unit_of_measure: product?.unit_of_measure ?? "KG",
          qty_per_unit: qtyPerUnit,
          total_required: Math.round(totalRequired * 10000) / 10000,
        };
      }
    );

    explosions.push({
      finished_good_id: item.product_id,
      finished_good_name: item.product_name || (invoice.finished_good?.name ?? "Finished Good"),
      bom_id: bom.id,
      bom_version: bom.version,
      sales_qty: item.quantity,
      unit_of_measure: item.unit_of_measure,
      components,
    });
  }

  // ── 3. Aggregate raw material requirements ──────────────────────────────
  const materialMap = new Map<
    string,
    {
      raw_material_id: string;
      raw_material_name: string;
      raw_material_sku: string;
      unit_of_measure: string;
      total_required: number;
      source_finished_goods: string[];
    }
  >();

  for (const explosion of explosions) {
    for (const comp of explosion.components) {
      const existing = materialMap.get(comp.raw_material_id);
      if (existing) {
        existing.total_required += comp.total_required;
        existing.total_required =
          Math.round(existing.total_required * 10000) / 10000;
        if (!existing.source_finished_goods.includes(explosion.finished_good_name)) {
          existing.source_finished_goods.push(explosion.finished_good_name);
        }
      } else {
        materialMap.set(comp.raw_material_id, {
          raw_material_id: comp.raw_material_id,
          raw_material_name: comp.raw_material_name,
          raw_material_sku: comp.raw_material_sku,
          unit_of_measure: comp.unit_of_measure,
          total_required: comp.total_required,
          source_finished_goods: [explosion.finished_good_name],
        });
      }
    }
  }

  // ── 4. Query unrestricted inventory for each raw material ───────────────
  const rawMaterialIds = Array.from(materialMap.keys());
  const inventoryMap = new Map<string, InventorySnapshot[]>();

  if (rawMaterialIds.length > 0) {
    // Query in batches of 50 to avoid URL length issues
    const batchSize = 50;
    for (let i = 0; i < rawMaterialIds.length; i += batchSize) {
      const batch = rawMaterialIds.slice(i, i + batchSize);
      const invRes = await fetch(
        `${SUPABASE_URL}/rest/v1/inventory_lots?product_id=in.(${batch.join(",")})&status=eq.unrestricted&remaining_qty=gt.0&select=*,products_master(name,sku),inventory_warehouses(code)&order=expiration_date.asc`,
        { headers: headers() }
      );

      if (invRes.ok) {
        const invData = await invRes.json();
        if (Array.isArray(invData)) {
          for (const row of invData) {
            const productId = row.product_id as string;
            if (!inventoryMap.has(productId)) {
              inventoryMap.set(productId, []);
            }
            const product = row.products_master as { name: string; sku: string } | null;
            const warehouse = row.inventory_warehouses as { code: string } | null;
            inventoryMap.get(productId)!.push({
              product_id: productId,
              product_name: product?.name ?? "Unknown",
              lot_number: row.lot_number as string,
              remaining_qty: Number(row.remaining_qty) || 0,
              unit_cost_pkr: Number(row.unit_cost_pkr) || 0,
              warehouse_code: warehouse?.code ?? "WH-01",
              expiration_date: (row.expiration_date as string) ?? "",
              status: (row.status as string) ?? "unrestricted",
            });
          }
        }
      }
    }
  }

  // ── 5. Compute net requirements ─────────────────────────────────────────
  const requirements: MaterialRequirement[] = [];
  const purchaseRequisitions: PurchaseRequisition[] = [];
  let totalDeficitValue = 0;

  for (const [productId, req] of materialMap) {
    const lots = inventoryMap.get(productId) ?? [];
    const onHand = lots.reduce((sum, l) => sum + l.remaining_qty, 0);
    const onHandCost = lots.reduce(
      (sum, l) => sum + l.remaining_qty * l.unit_cost_pkr,
      0
    );

    const netDeficit = Math.max(0, req.total_required - onHand);
    const safetyStock = 0; // Could be fetched from products_master.minimum_stock_alert
    const suggestedPRQty = Math.ceil(netDeficit * 100) / 100; // Round up to 2 decimals

    // FIFO lot consumption plan
    const consumedLots: LotConsumption[] = [];
    let remainingToConsume = Math.min(onHand, req.total_required);

    for (const lot of lots) {
      if (remainingToConsume <= 0) break;
      const allocQty = Math.min(lot.remaining_qty, remainingToConsume);
      consumedLots.push({
        lot_id: lot.lot_number,
        lot_number: lot.lot_number,
        warehouse_code: lot.warehouse_code,
        available_qty: lot.remaining_qty,
        unit_cost_pkr: lot.unit_cost_pkr,
        allocated_qty: Math.round(allocQty * 10000) / 10000,
      });
      remainingToConsume -= allocQty;
    }

    const avgCost = onHand > 0 ? onHandCost / onHand : 0;
    const estimatedCost = suggestedPRQty * avgCost;

    requirements.push({
      raw_material_id: productId,
      raw_material_name: req.raw_material_name,
      raw_material_sku: req.raw_material_sku,
      unit_of_measure: req.unit_of_measure,
      total_required: req.total_required,
      on_hand_unrestricted: Math.round(onHand * 10000) / 10000,
      on_hand_cost_pkr: Math.round(onHandCost * 100) / 100,
      net_deficit: Math.round(netDeficit * 10000) / 10000,
      suggested_pr_qty: suggestedPRQty,
      safety_stock: safetyStock,
      lead_time_days: 7, // Default; could be fetched from product master
      estimated_cost_pkr: Math.round(estimatedCost * 100) / 100,
      consumed_from_lots: consumedLots,
      source_finished_goods: req.source_finished_goods,
    });

    // Generate PR for deficit items
    if (suggestedPRQty > 0) {
      totalDeficitValue += estimatedCost;

      let priority: PurchaseRequisition["priority"] = "MEDIUM";
      if (netDeficit > req.total_required * 0.5) priority = "CRITICAL";
      else if (netDeficit > req.total_required * 0.25) priority = "HIGH";
      else if (netDeficit < req.total_required * 0.1) priority = "LOW";

      purchaseRequisitions.push({
        raw_material_id: productId,
        raw_material_name: req.raw_material_name,
        raw_material_sku: req.raw_material_sku,
        unit_of_measure: req.unit_of_measure,
        requisition_qty: suggestedPRQty,
        estimated_unit_cost_pkr: Math.round(avgCost * 100) / 100,
        estimated_total_cost_pkr: Math.round(estimatedCost * 100) / 100,
        suggested_supplier: "", // Could be fetched from preferred supplier
        priority,
      });
    }
  }

  // ── 6. Build result ─────────────────────────────────────────────────────
  const itemsWithSufficient = requirements.filter(
    (r) => r.net_deficit <= 0
  ).length;
  const itemsWithDeficit = requirements.filter(
    (r) => r.net_deficit > 0
  ).length;

  const result: MRPResult = {
    sales_order_id: salesOrderId,
    sales_order_number: invoice.invoice_number ?? "UNKNOWN",
    calculated_at: new Date().toISOString(),
    total_finished_goods: explosions.length,
    total_raw_materials: requirements.length,
    total_estimated_cost_pkr: Math.round(totalDeficitValue * 100) / 100,
    explosions,
    requirements,
    purchase_requisitions: purchaseRequisitions.sort((a, b) => {
      const priorityOrder = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
      return priorityOrder[a.priority] - priorityOrder[b.priority];
    }),
    summary: {
      items_with_sufficient_stock: itemsWithSufficient,
      items_with_deficit: itemsWithDeficit,
      total_deficit_value_pkr: Math.round(totalDeficitValue * 100) / 100,
    },
  };

  // ── 7. Audit log ────────────────────────────────────────────────────────
  fetch(`${SUPABASE_URL}/rest/v1/system_audit_logs`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      operator_name: "MRP Engine",
      action_type: "MRP_CALCULATION_COMPLETED",
      module: "PP",
      details: {
        sales_order_id: salesOrderId,
        invoice_number: result.sales_order_number,
        finished_goods: result.total_finished_goods,
        raw_materials: result.total_raw_materials,
        items_with_deficit: result.summary.items_with_deficit,
        total_estimated_cost_pkr: result.total_estimated_cost_pkr,
      },
    }),
  }).catch(() => {});

  return result;
}

// ── Utility: Format MRP Result for Display ───────────────────────────────────

export function formatMRPSummary(result: MRPResult): string {
  const lines: string[] = [
    `MRP Calculation for ${result.sales_order_number}`,
    `Calculated: ${new Date(result.calculated_at).toLocaleString()}`,
    ``,
    `Finished Goods: ${result.total_finished_goods}`,
    `Raw Materials Required: ${result.total_raw_materials}`,
    ``,
    `Stock Status:`,
    `  Sufficient: ${result.summary.items_with_sufficient_stock}`,
    `  Deficit: ${result.summary.items_with_deficit}`,
    `  Estimated Deficit Cost: PKR ${result.summary.total_deficit_value_pkr.toLocaleString()}`,
    ``,
    `Purchase Requisitions: ${result.purchase_requisitions.length}`,
  ];

  for (const pr of result.purchase_requisitions) {
    lines.push(
      `  [${pr.priority}] ${pr.raw_material_name} (${pr.raw_material_sku}): ${pr.requisition_qty} ${pr.unit_of_measure} — PKR ${pr.estimated_total_cost_pkr.toLocaleString()}`
    );
  }

  return lines.join("\n");
}
