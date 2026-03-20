-- Add user_id and description columns to categories table
ALTER TABLE categories ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id);
ALTER TABLE categories ADD COLUMN IF NOT EXISTS description TEXT;

-- Add indexes for better performance
CREATE INDEX IF NOT EXISTS idx_categories_user_id ON categories(user_id);
CREATE INDEX IF NOT EXISTS idx_categories_status ON categories(status);
CREATE INDEX IF NOT EXISTS idx_categories_subcategories_user_id ON categories_subcategories(user_id);
CREATE INDEX IF NOT EXISTS idx_categories_subcategories_status ON categories_subcategories(status);

-- Add Stripe columns to plans table
ALTER TABLE plans
ADD COLUMN IF NOT EXISTS stripe_product_id text,
ADD COLUMN IF NOT EXISTS stripe_price_id text;

-- Make monthly_price_cents nullable for custom-priced plans
ALTER TABLE plans
ALTER COLUMN monthly_price_cents DROP NOT NULL;

-- Function to get schema information
CREATE OR REPLACE FUNCTION get_schema_info()
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    result json;
BEGIN
    WITH table_info AS (
        SELECT 
            t.table_name,
            json_agg(
                json_build_object(
                    'column_name', c.column_name,
                    'data_type', c.data_type,
                    'is_nullable', c.is_nullable,
                    'column_default', c.column_default,
                    'description', col_description((t.table_schema || '.' || t.table_name)::regclass, c.ordinal_position)
                ) ORDER BY c.ordinal_position
            ) as columns,
            (
                SELECT json_agg(
                    json_build_object(
                        'indexname', i.indexname,
                        'indexdef', i.indexdef
                    )
                )
                FROM pg_indexes i
                WHERE i.tablename = t.table_name
                AND i.schemaname = t.table_schema
            ) as indexes,
            (
                SELECT json_agg(
                    json_build_object(
                        'constraint_name', tc.constraint_name,
                        'table_name', tc.table_name,
                        'column_name', kcu.column_name,
                        'foreign_table_name', ccu.table_name,
                        'foreign_column_name', ccu.column_name
                    )
                )
                FROM information_schema.table_constraints tc
                JOIN information_schema.key_column_usage kcu
                    ON tc.constraint_name = kcu.constraint_name
                JOIN information_schema.constraint_column_usage ccu
                    ON ccu.constraint_name = tc.constraint_name
                WHERE tc.table_name = t.table_name
                AND tc.constraint_type = 'FOREIGN KEY'
            ) as foreign_keys
        FROM information_schema.tables t
        JOIN information_schema.columns c
            ON c.table_name = t.table_name
            AND c.table_schema = t.table_schema
        WHERE t.table_schema = 'public'
        AND t.table_type = 'BASE TABLE'
        GROUP BY t.table_schema, t.table_name
    )
    SELECT json_agg(table_info)
    INTO result
    FROM table_info;

    RETURN result;
END;
$$;
