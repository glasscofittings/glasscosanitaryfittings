-- Sidebar module visibility + per-user UI settings.
-- Hiding a menu item only changes navigation — it never touches business data.
CREATE TABLE IF NOT EXISTS user_settings (
    user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    sidebar_modules JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One row per signed-in user/terminal profile.
CREATE INDEX IF NOT EXISTS idx_user_settings_updated_at ON user_settings(updated_at DESC);

-- Row Level Security: users only ever see their own settings row.
ALTER TABLE user_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own settings" ON user_settings;
CREATE POLICY "Users read own settings"
    ON user_settings FOR SELECT
    USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users insert own settings" ON user_settings;
CREATE POLICY "Users insert own settings"
    ON user_settings FOR INSERT
    WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users update own settings" ON user_settings;
CREATE POLICY "Users update own settings"
    ON user_settings FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users delete own settings" ON user_settings;
CREATE POLICY "Users delete own settings"
    ON user_settings FOR DELETE
    USING (auth.uid() = user_id);

-- Example payload: {"dashboard":true,"crm":false,"invoicing":true, ...}
