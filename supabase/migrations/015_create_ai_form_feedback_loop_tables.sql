-- Feedback loop storage for AI form telemetry events

CREATE TABLE IF NOT EXISTS telemetry_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  session_id TEXT NOT NULL,
  instance_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  step_id TEXT,
  batch_id TEXT,
  model_request_id TEXT,
  payload_json JSONB
);

CREATE INDEX IF NOT EXISTS idx_telemetry_events_session_id ON telemetry_events(session_id);
CREATE INDEX IF NOT EXISTS idx_telemetry_events_instance_id ON telemetry_events(instance_id);
CREATE INDEX IF NOT EXISTS idx_telemetry_events_event_type ON telemetry_events(event_type);
CREATE INDEX IF NOT EXISTS idx_telemetry_events_step_id ON telemetry_events(step_id);
CREATE INDEX IF NOT EXISTS idx_telemetry_events_created_at ON telemetry_events(created_at DESC);

ALTER TABLE telemetry_events ENABLE ROW LEVEL SECURITY;

-- Public inserts for client-side telemetry
CREATE POLICY "Allow public insert to telemetry_events"
  ON telemetry_events FOR INSERT
  WITH CHECK (true);

-- Public reads for analytics (adjust as needed)
CREATE POLICY "Allow public read to telemetry_events"
  ON telemetry_events FOR SELECT
  USING (true);
