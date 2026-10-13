-- =============================================================================
-- QC LOT LOCK SYSTEM — Status Column + Deduction Guard Trigger
-- Migration: 20260921_qc_lot_lock_system
-- =============================================================================

-- ── 1. Add `status` column to inventory_lots ────────────────────────────────
-- Maps: PENDING -> quality_inspection, PASSED -> unrestricted, FLAGGED_WARNING -> blocked
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'inventory_lots' AND column_name = 'status'
  ) THEN
    ALTER TABLE public.inventory_lots
      ADD COLUMN status TEXT NOT NULL DEFAULT 'quality_inspection'
      CHECK (status IN ('quality_inspection', 'unrestricted', 'blocked'));
  END IF;
END $$;

-- Backfill status from existing qc_status
UPDATE public.inventory_lots
SET status = CASE
  WHEN qc_status = 'PASSED' THEN 'unrestricted'
  WHEN qc_status = 'FLAGGED_WARNING' THEN 'blocked'
  ELSE 'quality_inspection'
END
WHERE status = 'quality_inspection' AND qc_status IS NOT NULL;

-- Index for fast status lookups
CREATE INDEX IF NOT EXISTS idx_inventory_lots_status ON public.inventory_lots(status);

-- ── 2. Create deduction guard trigger function ──────────────────────────────
-- Prevents any UPDATE that reduces remaining_qty if lot status != 'unrestricted'
CREATE OR REPLACE FUNCTION public.guard_lot_deduction()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Only guard when remaining_qty is being reduced
  IF NEW.remaining_qty < OLD.remaining_qty THEN
    IF OLD.status != 'unrestricted' THEN
      RAISE EXCEPTION
        'Lot % is locked in status "%". Material cannot be deducted or consumed until status is "unrestricted".',
        OLD.lot_number, OLD.status;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- ── 3. Attach trigger to inventory_lots ─────────────────────────────────────
DROP TRIGGER IF EXISTS trg_guard_lot_deduction ON public.inventory_lots;
CREATE TRIGGER trg_guard_lot_deduction
  BEFORE UPDATE OF remaining_qty ON public.inventory_lots
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_lot_deduction();

-- ── 4. Also guard against DELETE on locked lots ─────────────────────────────
CREATE OR REPLACE FUNCTION public.guard_lot_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF OLD.status != 'unrestricted' AND OLD.remaining_qty > 0 THEN
    RAISE EXCEPTION
      'Lot % is locked in status "%" with remaining qty %. Cannot delete a locked lot.',
      OLD.lot_number, OLD.status, OLD.remaining_qty;
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_lot_delete ON public.inventory_lots;
CREATE TRIGGER trg_guard_lot_delete
  BEFORE DELETE ON public.inventory_lots
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_lot_delete();

-- ── 5. Sync status with qc_status on INSERT/UPDATE ─────────────────────────
-- Ensures status stays consistent when qc_status changes via existing code
CREATE OR REPLACE FUNCTION public.sync_lot_status_from_qc()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- When qc_status changes, update status accordingly
  IF NEW.qc_status IS DISTINCT FROM OLD.qc_status THEN
    NEW.status := CASE
      WHEN NEW.qc_status = 'PASSED' THEN 'unrestricted'
      WHEN NEW.qc_status = 'FLAGGED_WARNING' THEN 'blocked'
      ELSE 'quality_inspection'
    END;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_lot_status ON public.inventory_lots;
CREATE TRIGGER trg_sync_lot_status
  BEFORE UPDATE OF qc_status ON public.inventory_lots
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_lot_status_from_qc();

-- ── 6. GRANT execute on guard functions ─────────────────────────────────────
GRANT EXECUTE ON FUNCTION public.guard_lot_deduction() TO authenticated;
GRANT EXECUTE ON FUNCTION public.guard_lot_delete() TO authenticated;

-- =============================================================================
-- END OF MIGRATION
-- =============================================================================
