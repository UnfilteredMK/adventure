-- Create shopify_stores table to store OAuth tokens and shop info
CREATE TABLE IF NOT EXISTS shopify_stores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_domain TEXT NOT NULL UNIQUE,
  shop_id TEXT NOT NULL,
  shop_name TEXT,
  shop_owner_email TEXT,
  access_token TEXT NOT NULL, -- Encrypted in application layer
  installed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_shopify_stores_store_domain ON shopify_stores(store_domain);
CREATE INDEX IF NOT EXISTS idx_shopify_stores_shop_id ON shopify_stores(shop_id);
CREATE INDEX IF NOT EXISTS idx_shopify_stores_shop_owner_email ON shopify_stores(shop_owner_email);

-- Create accounts_shopify junction table to link accounts to Shopify stores
CREATE TABLE IF NOT EXISTS accounts_shopify (
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  shopify_store_id UUID NOT NULL REFERENCES shopify_stores(id) ON DELETE CASCADE,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  PRIMARY KEY (account_id, shopify_store_id)
);

-- Create indexes for junction table
CREATE INDEX IF NOT EXISTS idx_accounts_shopify_account_id ON accounts_shopify(account_id);
CREATE INDEX IF NOT EXISTS idx_accounts_shopify_shopify_store_id ON accounts_shopify(shopify_store_id);
CREATE INDEX IF NOT EXISTS idx_accounts_shopify_active ON accounts_shopify(is_active) WHERE is_active = true;

-- Add updated_at trigger for shopify_stores
CREATE OR REPLACE FUNCTION update_shopify_stores_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_shopify_stores_updated_at
  BEFORE UPDATE ON shopify_stores
  FOR EACH ROW
  EXECUTE FUNCTION update_shopify_stores_updated_at();

-- Enable RLS
ALTER TABLE shopify_stores ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounts_shopify ENABLE ROW LEVEL SECURITY;

-- RLS Policies for shopify_stores
-- Users can read their own shopify stores (via accounts_shopify relationship)
CREATE POLICY "Users can read shopify stores linked to their accounts"
  ON shopify_stores
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM accounts_shopify
      JOIN user_accounts ON accounts_shopify.account_id = user_accounts.account_id
      WHERE accounts_shopify.shopify_store_id = shopify_stores.id
      AND user_accounts.user_id = auth.uid()
      AND accounts_shopify.is_active = true
    )
  );

-- Service role can do everything (for API routes)
CREATE POLICY "Service role can manage shopify stores"
  ON shopify_stores
  FOR ALL
  USING (auth.role() = 'service_role');

-- RLS Policies for accounts_shopify
-- Users can read links for accounts they have access to
CREATE POLICY "Users can read shopify account links for their accounts"
  ON accounts_shopify
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_accounts
      WHERE user_accounts.account_id = accounts_shopify.account_id
      AND user_accounts.user_id = auth.uid()
    )
  );

-- Users can insert links for accounts they own
CREATE POLICY "Users can link shopify stores to their owned accounts"
  ON accounts_shopify
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_accounts
      WHERE user_accounts.account_id = accounts_shopify.account_id
      AND user_accounts.user_id = auth.uid()
      AND user_accounts.user_status = 'owner'
    )
  );

-- Users can update links for accounts they own
CREATE POLICY "Users can update shopify store links for their owned accounts"
  ON accounts_shopify
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM user_accounts
      WHERE user_accounts.account_id = accounts_shopify.account_id
      AND user_accounts.user_id = auth.uid()
      AND user_accounts.user_status = 'owner'
    )
  );

-- Users can delete links for accounts they own
CREATE POLICY "Users can unlink shopify stores from their owned accounts"
  ON accounts_shopify
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM user_accounts
      WHERE user_accounts.account_id = accounts_shopify.account_id
      AND user_accounts.user_id = auth.uid()
      AND user_accounts.user_status = 'owner'
    )
  );

-- Service role can do everything
CREATE POLICY "Service role can manage shopify account links"
  ON accounts_shopify
  FOR ALL
  USING (auth.role() = 'service_role');

