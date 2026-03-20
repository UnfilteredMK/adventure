-- Recreate account_credit_transactions with enum-backed schema
DROP TABLE IF EXISTS public.account_credit_transactions;

-- Drop types if they exist (safe because table is dropped first)
DO $$ BEGIN
  PERFORM 1 FROM pg_type WHERE typname = 'credit_transaction_type';
  IF FOUND THEN EXECUTE 'DROP TYPE credit_transaction_type'; END IF;
END $$;

DO $$ BEGIN
  PERFORM 1 FROM pg_type WHERE typname = 'credit_reload_type';
  IF FOUND THEN EXECUTE 'DROP TYPE credit_reload_type'; END IF;
END $$;

DO $$ BEGIN
  PERFORM 1 FROM pg_type WHERE typname = 'credit_reload_attempt_status';
  IF FOUND THEN EXECUTE 'DROP TYPE credit_reload_attempt_status'; END IF;
END $$;

DO $$ BEGIN
  PERFORM 1 FROM pg_type WHERE typname = 'credit_reload_attempt_description';
  IF FOUND THEN EXECUTE 'DROP TYPE credit_reload_attempt_description'; END IF;
END $$;

-- Enumerations
CREATE TYPE credit_transaction_type AS ENUM ('image_gen','email_lead','phone_lead','credit_reload');
CREATE TYPE credit_reload_type AS ENUM ('manual','auto');
CREATE TYPE credit_reload_attempt_status AS ENUM ('succeeded','declined','failed','requires_action','pending','other');
CREATE TYPE credit_reload_attempt_description AS ENUM ('insufficient_funds','card_expired','no_default_payment_method','authentication_required','other');

-- Table
CREATE TABLE public.account_credit_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  account_id uuid NOT NULL,
  instance_id uuid NULL,
  type credit_transaction_type NOT NULL,
  credit_amount integer NOT NULL,
  reload_type credit_reload_type NULL,
  reload_attempt_status credit_reload_attempt_status NULL,
  reload_attempt_description credit_reload_attempt_description NULL,
  description text NULL,
  metadata jsonb NULL
);

-- Indexes
CREATE INDEX idx_account_credit_transactions_account ON public.account_credit_transactions(account_id);
CREATE INDEX idx_account_credit_transactions_instance ON public.account_credit_transactions(instance_id);
CREATE INDEX idx_account_credit_transactions_created ON public.account_credit_transactions(created_at DESC);
CREATE INDEX idx_account_credit_transactions_type ON public.account_credit_transactions(type);

-- Enable RLS (policies to be defined separately)
ALTER TABLE public.account_credit_transactions ENABLE ROW LEVEL SECURITY;


