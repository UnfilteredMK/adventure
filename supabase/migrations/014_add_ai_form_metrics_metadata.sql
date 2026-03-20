-- Add optional metadata + confidence to AI form metrics for visual-first instrumentation

ALTER TABLE ai_form_sessions
  ADD COLUMN IF NOT EXISTS metadata JSONB;

ALTER TABLE ai_form_step_metrics
  ADD COLUMN IF NOT EXISTS component_type TEXT,
  ADD COLUMN IF NOT EXISTS confidence DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS metadata JSONB;

CREATE INDEX IF NOT EXISTS idx_ai_form_step_metrics_component_type ON ai_form_step_metrics(component_type);

