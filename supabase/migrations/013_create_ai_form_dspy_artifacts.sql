-- DSPy artifacts for AI Form progressive planning

CREATE TABLE IF NOT EXISTS instance_ai_form_dspy_artifacts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  instance_id TEXT NOT NULL,
  context_key TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  artifact_json JSONB NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Only one active artifact per instance + context
CREATE UNIQUE INDEX IF NOT EXISTS instance_ai_form_dspy_artifacts_one_active
ON instance_ai_form_dspy_artifacts (instance_id, context_key)
WHERE active = TRUE;

CREATE INDEX IF NOT EXISTS instance_ai_form_dspy_artifacts_instance_idx
ON instance_ai_form_dspy_artifacts (instance_id);

-- Service-role-only access (RLS enabled, no policies). Service role bypasses RLS.
ALTER TABLE instance_ai_form_dspy_artifacts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE instance_ai_form_dspy_artifacts FROM anon;
REVOKE ALL ON TABLE instance_ai_form_dspy_artifacts FROM authenticated;


