import { createBrowserClient } from '@supabase/ssr'

export interface DashboardKPIs {
  raw_material_value_pkr: number
  finished_goods_value_pkr: number
  active_batch_orders_count: number
  qc_warning_lots_count: number
  trial_balance_status: string
}

export interface AuditLog {
  id: string
  device_node: string
  operator_name: string
  action_type: string
  module: string
  payload: Record<string, any>
  created_at: string
}

export interface PeriodNetProfit {
  period: string
  net_profit: number
}

export interface ProductionConsumptionPoint {
  period: string
  dispatched_qty: number
  received_qty: number
}

export function createClient() {
  const rawUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co'
  const url = rawUrl.replace(/\/$/, '')
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-anon-key'
  return createBrowserClient(url, key)
}

function headers(): HeadersInit {
  return {
    apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
    Authorization: `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''}`,
    'Content-Type': 'application/json',
  }
}

export async function fetchDashboardKPIs(): Promise<DashboardKPIs> {
  const defaultKPIs: DashboardKPIs = {
    raw_material_value_pkr: 0,
    finished_goods_value_pkr: 0,
    active_batch_orders_count: 0,
    qc_warning_lots_count: 0,
    trial_balance_status: 'BALANCED',
  }
  const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
  const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!SUPABASE_URL) return defaultKPIs
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/dashboard_kpis?select=*&limit=1`,
      {
        headers: {
          apikey: SUPABASE_ANON_KEY ?? '',
          Authorization: `Bearer ${SUPABASE_ANON_KEY ?? ''}`,
          'Content-Type': 'application/json',
        },
      }
    )
    if (!res.ok) {
      console.error('Supabase Error [dashboard_kpis]:', { status: res.status, body: await res.json() })
      return defaultKPIs
    }
    const data = await res.json()
    return (Array.isArray(data) && data.length > 0) ? data[0] as DashboardKPIs : defaultKPIs
  } catch (err) {
    console.error('Supabase Error [dashboard_kpis]:', err)
    return defaultKPIs
  }
}

export async function fetchAuditLogs(): Promise<AuditLog[]> {
  const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
  const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!SUPABASE_URL) return []
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/system_audit_logs?select=id,node_id,operator_name,action_type,details,timestamp&order=timestamp.desc&limit=50`,
      {
        headers: {
          apikey: SUPABASE_ANON_KEY ?? '',
          Authorization: `Bearer ${SUPABASE_ANON_KEY ?? ''}`,
          'Content-Type': 'application/json',
        },
      }
    )
    if (!res.ok) {
      console.error('Supabase Error [system_audit_logs]:', { status: res.status, body: await res.json() })
      return []
    }
    const data = await res.json()
    return (Array.isArray(data) ? data : []).map((item: any) => ({
      id: item.id,
      device_node: item.device_node || item.node_id || 'NODE-01',
      operator_name: item.operator_name,
      action_type: item.action_type,
      module: item.module || item.action_type?.split('_')[0] || 'SYSTEM',
      payload: item.payload || item.details || {},
      created_at: item.timestamp || item.created_at,
    }))
  } catch (err) {
    console.error('Supabase Error [system_audit_logs]:', err)
    return []
  }
}

export async function fetchWorkerCount(): Promise<number> {
  const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!SUPABASE_URL) return 0
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/workers?select=id&status=eq.ACTIVE`,
      { headers: headers() }
    )
    if (!res.ok) return 0
    const data = await res.json()
    return Array.isArray(data) ? data.length : 0
  } catch {
    return 0
  }
}

export async function fetchDashboardStockValue(): Promise<{ raw_material_value_pkr: number; finished_goods_value_pkr: number }> {
  const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!SUPABASE_URL) return { raw_material_value_pkr: 0, finished_goods_value_pkr: 0 }

  const defaultResult = { raw_material_value_pkr: 0, finished_goods_value_pkr: 0 }

  // Strategy 1: Query inventory_lots (ideal path — lots created by convert_igp_to_grn)
  try {
    const lotRes = await fetch(
      `${SUPABASE_URL}/rest/v1/inventory_lots?select=remaining_qty,unit_cost_pkr,product:products_master(item_type)`,
      { headers: headers() }
    )
    if (lotRes.ok) {
      const lots = await lotRes.json()
      if (Array.isArray(lots) && lots.length > 0) {
        let raw = 0
        let finished = 0
        for (const lot of lots) {
          const product = lot.product
          const value = (Number(lot.remaining_qty) || 0) * (Number(lot.unit_cost_pkr) || 0)
          if (!product || product.item_type === 'RAW_MATERIAL') raw += value
          else if (product.item_type === 'FINISHED_GOOD') finished += value
        }
        if (raw > 0 || finished > 0) return { raw_material_value_pkr: raw, finished_goods_value_pkr: finished }
      }
    }
  } catch { /* fall through to GRN fallback */ }

  // Strategy 2: Fallback to goods_received_notes (if lots weren't created by older RPC)
  try {
    const grnRes = await fetch(
      `${SUPABASE_URL}/rest/v1/goods_received_notes?select=accepted_qty,unit_price_pkr,total_value_pkr,igp_id,inward_gate_passes!inner(material_description)`,
      { headers: headers() }
    )
    if (grnRes.ok) {
      const grns = await grnRes.json()
      if (Array.isArray(grns) && grns.length > 0) {
        let raw = 0
        for (const grn of grns) {
          raw += Number(grn.total_value_pkr) || (Number(grn.accepted_qty) || 0) * (Number(grn.unit_price_pkr) || 0)
        }
        if (raw > 0) return { raw_material_value_pkr: raw, finished_goods_value_pkr: 0 }
      }
    }
  } catch { /* fall through to inventory_balances fallback */ }

  // Strategy 3: Final fallback — inventory_balances × last known unit cost from GRN
  try {
    const balRes = await fetch(
      `${SUPABASE_URL}/rest/v1/inventory_balances?select=current_qty,warehouse:inventory_warehouses(code),product:products_master(name)`,
      { headers: headers() }
    )
    if (balRes.ok) {
      const balances = await balRes.json()
      if (Array.isArray(balances) && balances.length > 0) {
        // Attempt to get unit costs from GRN for matching material descriptions
        const grnRes2 = await fetch(
          `${SUPABASE_URL}/rest/v1/goods_received_notes?select=unit_price_pkr,inward_gate_passes!inner(material_description)`,
          { headers: headers() }
        )
        const grns2 = grnRes2.ok ? await grnRes2.json() : []
        const priceMap = new Map<string, number>()
        if (Array.isArray(grns2)) {
          for (const g of grns2) {
            const name = g.inward_gate_passes?.material_description
            if (name && !priceMap.has(name)) priceMap.set(name, Number(g.unit_price_pkr) || 0)
          }
        }
        let raw = 0
        for (const bal of balances) {
          const qty = Number(bal.current_qty) || 0
          const productName = bal.product?.name
          const unitCost = priceMap.get(productName) || 0
          raw += qty * unitCost
        }
        if (raw > 0) return { raw_material_value_pkr: raw, finished_goods_value_pkr: 0 }
      }
    }
  } catch { /* all strategies failed */ }

  return defaultResult
}

export async function fetchNetProfitByPeriod(range: 'day' | 'week' | 'month'): Promise<PeriodNetProfit[]> {
  const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!SUPABASE_URL) return [{ period: 'today', net_profit: 0 }]
  try {
    const now = new Date()
    let startDate: string
    if (range === 'day') {
      startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 29).toISOString()
    } else if (range === 'week') {
      startDate = new Date(now.getFullYear(), now.getMonth() - 2, now.getDate()).toISOString()
    } else {
      startDate = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate()).toISOString()
    }

    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/journal_entries?select=*,journal_lines(debit_pkr,credit_pkr,accounts_chart(account_type))&status=eq.POSTED&entry_date=gte.${startDate.split('T')[0]}&order=entry_date.asc`,
      { headers: headers() }
    )
    if (!res.ok) return [{ period: 'today', net_profit: 0 }]
    const entries = await res.json()

    // If no journal entries exist, return a single zero-value period so the chart renders
    if (!Array.isArray(entries) || entries.length === 0) {
      return [{ period: now.toISOString().split('T')[0], net_profit: 0 }]
    }

    const grouped = new Map<string, { revenue: number; expense: number }>()
    for (const entry of entries) {
      const dateStr = entry.entry_date?.split('T')[0] || entry.created_at?.split('T')[0]
      if (!dateStr) continue
      let bucket: string
      if (range === 'day') {
        bucket = dateStr
      } else if (range === 'week') {
        const d = new Date(dateStr)
        const startOfYear = new Date(d.getFullYear(), 0, 1)
        const weekNum = Math.ceil(((d.getTime() - startOfYear.getTime()) / 86400000 + d.getDay() + 1) / 7)
        bucket = `${d.getFullYear()}-W${String(weekNum).padStart(2, '0')}`
      } else {
        bucket = dateStr.substring(0, 7)
      }

      if (!grouped.has(bucket)) grouped.set(bucket, { revenue: 0, expense: 0 })
      const agg = grouped.get(bucket)!

      for (const line of entry.journal_lines || []) {
        const accType = line.accounts_chart?.account_type
        if (accType === 'REVENUE') agg.revenue += Number(line.credit_pkr) - Number(line.debit_pkr)
        else if (accType === 'EXPENSE') agg.expense += Number(line.debit_pkr) - Number(line.credit_pkr)
      }
    }

    const result = Array.from(grouped.entries()).map(([period, v]) => ({
      period,
      net_profit: v.revenue - v.expense,
    }))

    // Ensure at least one data point exists
    if (result.length === 0) {
      return [{ period: now.toISOString().split('T')[0], net_profit: 0 }]
    }

    return result
  } catch {
    return [{ period: new Date().toISOString().split('T')[0], net_profit: 0 }]
  }
}

export async function fetchProductionConsumption(range: 'day' | 'week' | 'month'): Promise<ProductionConsumptionPoint[]> {
  const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!SUPABASE_URL) return []
  try {
    const now = new Date()
    let startDate: string
    if (range === 'day') {
      startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 29).toISOString()
    } else if (range === 'week') {
      startDate = new Date(now.getFullYear(), now.getMonth() - 2, now.getDate()).toISOString()
    } else {
      startDate = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate()).toISOString()
    }

    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/inventory_lots?select=created_at,initial_qty,remaining_qty,product:products_master(item_type)&created_at=gte.${startDate}&order=created_at.asc`,
      { headers: headers() }
    )
    if (!res.ok) return []
    const lots = await res.json()
    if (!Array.isArray(lots) || lots.length === 0) return []

    const grouped = new Map<string, { dispatched: number; received: number }>()
    for (const lot of lots) {
      const dateStr = lot.created_at?.split('T')[0]
      if (!dateStr) continue
      let bucket: string
      if (range === 'day') {
        bucket = dateStr
      } else if (range === 'week') {
        const d = new Date(dateStr)
        const startOfYear = new Date(d.getFullYear(), 0, 1)
        const weekNum = Math.ceil(((d.getTime() - startOfYear.getTime()) / 86400000 + startOfYear.getDay() + 1) / 7)
        bucket = `${d.getFullYear()}-W${String(weekNum).padStart(2, '0')}`
      } else {
        bucket = dateStr.substring(0, 7)
      }

      if (!grouped.has(bucket)) grouped.set(bucket, { dispatched: 0, received: 0 })
      const agg = grouped.get(bucket)!
      const initial = Number(lot.initial_qty) || 0
      const remaining = Number(lot.remaining_qty) || 0
      const consumed = initial - remaining

      if (lot.product?.item_type === 'RAW_MATERIAL') {
        agg.dispatched += consumed
      } else {
        agg.received += initial
      }
    }

    return Array.from(grouped.entries()).map(([period, v]) => ({
      period,
      dispatched_qty: v.dispatched,
      received_qty: v.received,
    }))
  } catch {
    return []
  }
}
