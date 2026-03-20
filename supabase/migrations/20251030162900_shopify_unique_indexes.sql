-- Ensure unique identifiers for Shopify stores
create unique index if not exists shopify_stores_store_domain_key
  on public.shopify_stores (store_domain);

create unique index if not exists shopify_stores_shop_id_key
  on public.shopify_stores (shop_id);


