-- Add flow mode columns to existing form_submissions table

BEGIN;

-- Add submission_type to distinguish between lead_capture and flow submissions
ALTER TABLE form_submissions
ADD COLUMN IF NOT EXISTS submission_type TEXT DEFAULT 'lead_capture' CHECK (submission_type IN ('lead_capture', 'flow'));

-- Add flow-specific columns (nullable, only used for flow submissions)
ALTER TABLE form_submissions
ADD COLUMN IF NOT EXISTS current_step INTEGER;

ALTER TABLE form_submissions
ADD COLUMN IF NOT EXISTS generated_designs JSONB;

ALTER TABLE form_submissions
ADD COLUMN IF NOT EXISTS category_id UUID REFERENCES categories(id) ON DELETE SET NULL;

ALTER TABLE form_submissions
ADD COLUMN IF NOT EXISTS subcategory_id UUID REFERENCES categories_subcategories(id) ON DELETE SET NULL;

ALTER TABLE form_submissions
ADD COLUMN IF NOT EXISTS status TEXT CHECK (status IN ('in_progress', 'completed', 'abandoned'));

ALTER TABLE form_submissions
ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;

-- Add indexes for flow queries
CREATE INDEX IF NOT EXISTS idx_form_submissions_submission_type ON form_submissions(submission_type);
CREATE INDEX IF NOT EXISTS idx_form_submissions_status ON form_submissions(status) WHERE submission_type = 'flow';
CREATE INDEX IF NOT EXISTS idx_form_submissions_category_id ON form_submissions(category_id);
CREATE INDEX IF NOT EXISTS idx_form_submissions_subcategory_id ON form_submissions(subcategory_id);

-- Add comment
COMMENT ON COLUMN form_submissions.submission_type IS 'Type of submission: lead_capture (default) or flow';
COMMENT ON COLUMN form_submissions.current_step IS 'Current step in flow (only for flow submissions)';
COMMENT ON COLUMN form_submissions.generated_designs IS 'Generated designs during flow (only for flow submissions)';
COMMENT ON COLUMN form_submissions.status IS 'Flow status: in_progress, completed, or abandoned (only for flow submissions)';

COMMIT;
