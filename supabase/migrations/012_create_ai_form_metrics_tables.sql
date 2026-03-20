-- Create tables for AI Form metrics tracking

-- AI Form Sessions table
CREATE TABLE IF NOT EXISTS ai_form_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  entry_source TEXT,
  session_goal TEXT,
  steps_completed INTEGER DEFAULT 0,
  abandoned_at_step INTEGER,
  converted BOOLEAN DEFAULT false,
  lead_captured BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_form_sessions_instance_id ON ai_form_sessions(instance_id);
CREATE INDEX IF NOT EXISTS idx_ai_form_sessions_session_id ON ai_form_sessions(session_id);
CREATE INDEX IF NOT EXISTS idx_ai_form_sessions_created_at ON ai_form_sessions(created_at DESC);

-- AI Form Step Metrics table
CREATE TABLE IF NOT EXISTS ai_form_step_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id TEXT NOT NULL,
  step_id TEXT NOT NULL,
  time_spent_ms INTEGER DEFAULT 0,
  dropped_off BOOLEAN DEFAULT false,
  back_navigation BOOLEAN DEFAULT false,
  designer_engagement BOOLEAN DEFAULT false,
  lead_input_completed BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- Note: session_id is TEXT, so we can't use a foreign key constraint
  -- We'll rely on application logic to maintain referential integrity
);

CREATE INDEX IF NOT EXISTS idx_ai_form_step_metrics_session_id ON ai_form_step_metrics(session_id);
CREATE INDEX IF NOT EXISTS idx_ai_form_step_metrics_step_id ON ai_form_step_metrics(step_id);
CREATE INDEX IF NOT EXISTS idx_ai_form_step_metrics_created_at ON ai_form_step_metrics(created_at DESC);

-- Add RLS policies (if needed)
ALTER TABLE ai_form_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_form_step_metrics ENABLE ROW LEVEL SECURITY;

-- Policy: Allow public read access to sessions (for analytics)
CREATE POLICY "Allow public read access to ai_form_sessions"
  ON ai_form_sessions FOR SELECT
  USING (true);

-- Policy: Allow public insert access to sessions
CREATE POLICY "Allow public insert access to ai_form_sessions"
  ON ai_form_sessions FOR INSERT
  WITH CHECK (true);

-- Policy: Allow public read access to step metrics
CREATE POLICY "Allow public read access to ai_form_step_metrics"
  ON ai_form_step_metrics FOR SELECT
  USING (true);

-- Policy: Allow public insert access to step metrics
CREATE POLICY "Allow public insert access to ai_form_step_metrics"
  ON ai_form_step_metrics FOR INSERT
  WITH CHECK (true);

