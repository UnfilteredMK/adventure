-- Migration to add async image generation support
-- This adds the image_generation_batches table and status columns to images table

BEGIN;

-- Add status and replicate_prediction_id columns to images table
ALTER TABLE images 
ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'completed',
ADD COLUMN IF NOT EXISTS replicate_prediction_id TEXT,
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();

-- Create image_generation_batches table
CREATE TABLE IF NOT EXISTS image_generation_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID REFERENCES accounts(id) ON DELETE CASCADE,
  instance_id UUID REFERENCES instances(id) ON DELETE CASCADE,
  subcategory_id UUID REFERENCES categories_subcategories(id) ON DELETE SET NULL,
  total_images INTEGER NOT NULL,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  prompts JSONB,
  metadata JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Add indexes for better performance
CREATE INDEX IF NOT EXISTS idx_image_generation_batches_account_id ON image_generation_batches(account_id);
CREATE INDEX IF NOT EXISTS idx_image_generation_batches_instance_id ON image_generation_batches(instance_id);
CREATE INDEX IF NOT EXISTS idx_image_generation_batches_status ON image_generation_batches(status);
CREATE INDEX IF NOT EXISTS idx_images_status ON images(status);
CREATE INDEX IF NOT EXISTS idx_images_replicate_prediction_id ON images(replicate_prediction_id);

-- Add trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create triggers for updated_at
DROP TRIGGER IF EXISTS update_image_generation_batches_updated_at ON image_generation_batches;
CREATE TRIGGER update_image_generation_batches_updated_at
    BEFORE UPDATE ON image_generation_batches
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_images_updated_at ON images;
CREATE TRIGGER update_images_updated_at
    BEFORE UPDATE ON images
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Add RLS policies for image_generation_batches
ALTER TABLE image_generation_batches ENABLE ROW LEVEL SECURITY;

-- Policy for users to see their own batches
CREATE POLICY "Users can view their own image generation batches" ON image_generation_batches
  FOR SELECT USING (
    account_id IN (
      SELECT account_id FROM user_accounts 
      WHERE user_id = auth.uid()
    )
  );

-- Policy for users to insert their own batches
CREATE POLICY "Users can create their own image generation batches" ON image_generation_batches
  FOR INSERT WITH CHECK (
    account_id IN (
      SELECT account_id FROM user_accounts 
      WHERE user_id = auth.uid()
    )
  );

-- Policy for users to update their own batches
CREATE POLICY "Users can update their own image generation batches" ON image_generation_batches
  FOR UPDATE USING (
    account_id IN (
      SELECT account_id FROM user_accounts 
      WHERE user_id = auth.uid()
    )
  );

COMMIT; 