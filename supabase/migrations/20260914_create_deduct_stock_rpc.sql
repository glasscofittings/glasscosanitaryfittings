-- ============================================================================
-- Migration: deduct_product_stock RPC
-- Date: 2026-09-14
-- Description: Atomic stock deduction function for product dispatch.
--              Includes stock validation, concurrent-safe UPDATE, and
--              grants execution to authenticated + service_role.
-- ============================================================================

-- 1. Drop old version if it exists
DROP FUNCTION IF EXISTS public.deduct_product_stock(UUID, INT);
DROP FUNCTION IF EXISTS public.deduct_product_stock(UUID, INTEGER);

-- 2. Create the RPC function
CREATE OR REPLACE FUNCTION public.deduct_product_stock(
  p_product_id UUID,
  p_quantity   INTEGER
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current_stock INTEGER;
BEGIN
  -- Lock the row to prevent concurrent race conditions
  SELECT available_stock INTO v_current_stock
  FROM sanitary_products
  WHERE id = p_product_id
  FOR UPDATE;

  IF v_current_stock IS NULL THEN
    RAISE EXCEPTION 'Product with ID % not found.', p_product_id;
  END IF;

  IF v_current_stock < p_quantity THEN
    RAISE EXCEPTION 'Insufficient stock. Required: %, Available: %', p_quantity, v_current_stock;
  END IF;

  UPDATE sanitary_products
  SET available_stock = available_stock - p_quantity
  WHERE id = p_product_id;

  RETURN TRUE;
END;
$$;

-- 3. Grant permissions
GRANT EXECUTE ON FUNCTION public.deduct_product_stock(UUID, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.deduct_product_stock(UUID, INTEGER) TO service_role;
