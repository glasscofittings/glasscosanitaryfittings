-- Enable pg_cron and pg_net extensions if available/needed
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- 1. System Backups Storage Table
CREATE TABLE IF NOT EXISTS system_backups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    backup_type TEXT NOT NULL CHECK (backup_type IN ('AUTOMATIC_24H', 'MANUAL')),
    data_snapshot JSONB NOT NULL,
    records_count INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for system_backups
CREATE INDEX IF NOT EXISTS idx_system_backups_created_at ON system_backups(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_system_backups_type ON system_backups(backup_type);

-- 2. Daily Automated Backup Function (24-Hour Cycle Snapshot)
CREATE OR REPLACE FUNCTION create_daily_system_backup()
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_backup_id UUID;
    v_snapshot JSONB;
    v_total_records INT := 0;
    v_inward_count INT := 0;
    v_wh01_count INT := 0;
    v_wh02_count INT := 0;
    v_sales_count INT := 0;
    v_ledger_count INT := 0;
    v_audit_count INT := 0;
BEGIN
    -- Count records for metadata
    SELECT COUNT(*) INTO v_inward_count FROM inward_gate_passes;
    SELECT COUNT(*) INTO v_wh01_count FROM inventory_wh01_raw;
    SELECT COUNT(*) INTO v_wh02_count FROM inventory_wh02_finished;
    
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'sales_invoices') THEN
        EXECUTE 'SELECT COUNT(*) FROM sales_invoices' INTO v_sales_count;
    END IF;
    
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'general_ledger') THEN
        EXECUTE 'SELECT COUNT(*) FROM general_ledger' INTO v_ledger_count;
    END IF;

    SELECT COUNT(*) INTO v_audit_count FROM system_audit_logs;

    v_total_records := v_inward_count + v_wh01_count + v_wh02_count + v_sales_count + v_ledger_count + v_audit_count;

    -- Build JSON snapshot of key tables
    v_snapshot := jsonb_build_object(
        'metadata', jsonb_build_object(
            'generated_at', NOW(),
            'backup_type', 'AUTOMATIC_24H',
            'total_records', v_total_records
        ),
        'tables', jsonb_build_object(
            'inward_gate_passes', (SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM inward_gate_passes t),
            'inventory_wh01_raw', (SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM inventory_wh01_raw t),
            'inventory_wh02_finished', (SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM inventory_wh02_finished t),
            'sales_invoices', CASE WHEN EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'sales_invoices') 
                                   THEN (SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM sales_invoices t)
                                   ELSE '[]'::jsonb END,
            'general_ledger', CASE WHEN EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'general_ledger') 
                                   THEN (SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM general_ledger t)
                                   ELSE '[]'::jsonb END,
            'system_audit_logs', (SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM system_audit_logs t)
        )
    );

    -- Insert backup record
    INSERT INTO system_backups (backup_type, data_snapshot, records_count)
    VALUES ('AUTOMATIC_24H', v_snapshot, v_total_records)
    RETURNING id INTO v_backup_id;

    -- Log audit entry
    INSERT INTO system_audit_logs (operator_name, node_id, action_type, details)
    VALUES (
        'SYSTEM_CRON',
        'DB_PRIMARY',
        'DAILY_BACKUP_CREATED',
        jsonb_build_object('backup_id', v_backup_id, 'records_count', v_total_records)
    );

    RETURN v_backup_id;
END;
$$;

-- Schedule pg_cron job to run every 24 hours at 00:00 UTC
SELECT cron.schedule(
    'daily-system-backup-job',
    '0 0 * * *',
    'SELECT create_daily_system_backup();'
);

-- 3. On-Demand / Custom Date Range Backup RPC
CREATE OR REPLACE FUNCTION generate_custom_backup_snapshot(
    start_date TIMESTAMPTZ,
    end_date TIMESTAMPTZ
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_backup_id UUID;
    v_snapshot JSONB;
    v_inward_data JSONB;
    v_wh01_data JSONB;
    v_wh02_data JSONB;
    v_sales_data JSONB;
    v_ledger_data JSONB;
    v_audit_data JSONB;
    v_total_records INT := 0;
BEGIN
    -- Filter inward_gate_passes by date range
    SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
    INTO v_inward_data
    FROM inward_gate_passes t
    WHERE t.created_at BETWEEN start_date AND end_date;

    -- Filter inventory_wh01_raw (all current snapshot since table has no created_at)
    SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
    INTO v_wh01_data
    FROM inventory_wh01_raw t;

    -- Filter inventory_wh02_finished (all current snapshot since table has no created_at)
    SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
    INTO v_wh02_data
    FROM inventory_wh02_finished t;

    -- Filter sales_invoices if table exists
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'sales_invoices') THEN
        EXECUTE 'SELECT COALESCE(jsonb_agg(to_jsonb(t)), ''[]''::jsonb) FROM sales_invoices t WHERE t.created_at BETWEEN $1 AND $2'
        INTO v_sales_data
        USING start_date, end_date;
    ELSE
        v_sales_data := '[]'::jsonb;
    END IF;

    -- Filter general_ledger if table exists
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'general_ledger') THEN
        EXECUTE 'SELECT COALESCE(jsonb_agg(to_jsonb(t)), ''[]''::jsonb) FROM general_ledger t WHERE t.created_at BETWEEN $1 AND $2'
        INTO v_ledger_data
        USING start_date, end_date;
    ELSE
        v_ledger_data := '[]'::jsonb;
    END IF;

    -- Filter system_audit_logs by date range
    SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
    INTO v_audit_data
    FROM system_audit_logs t
    WHERE t.timestamp BETWEEN start_date AND end_date;

    -- Calculate total records packaged
    v_total_records := jsonb_array_length(v_inward_data) +
                       jsonb_array_length(v_wh01_data) +
                       jsonb_array_length(v_wh02_data) +
                       jsonb_array_length(v_sales_data) +
                       jsonb_array_length(v_ledger_data) +
                       jsonb_array_length(v_audit_data);

    -- Build packaged snapshot object
    v_snapshot := jsonb_build_object(
        'metadata', jsonb_build_object(
            'generated_at', NOW(),
            'backup_type', 'MANUAL',
            'start_date', start_date,
            'end_date', end_date,
            'total_records', v_total_records
        ),
        'tables', jsonb_build_object(
            'inward_gate_passes', v_inward_data,
            'inventory_wh01_raw', v_wh01_data,
            'inventory_wh02_finished', v_wh02_data,
            'sales_invoices', v_sales_data,
            'general_ledger', v_ledger_data,
            'system_audit_logs', v_audit_data
        )
    );

    -- Store snapshot into system_backups table
    INSERT INTO system_backups (backup_type, data_snapshot, records_count)
    VALUES ('MANUAL', v_snapshot, v_total_records)
    RETURNING id INTO v_backup_id;

    -- Log action in system_audit_logs
    INSERT INTO system_audit_logs (operator_name, node_id, action_type, details)
    VALUES (
        CURRENT_USER,
        'RPC_NODE',
        'CUSTOM_BACKUP_GENERATED',
        jsonb_build_object(
            'backup_id', v_backup_id,
            'start_date', start_date,
            'end_date', end_date,
            'records_count', v_total_records
        )
    );

    RETURN jsonb_build_object(
        'status', 'SUCCESS',
        'backup_id', v_backup_id,
        'records_count', v_total_records,
        'snapshot', v_snapshot
    );
END;
$$;
