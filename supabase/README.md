Supabase shared artifacts

This directory is the repo-level source of truth for shared Supabase artifacts:

- `types.ts`: canonical generated TypeScript database types
- `schema.sql`: shared schema snapshot
- `migrations/*.sql`: shared migration history collected from the app-level Supabase directories

App-local Supabase runtime helpers still live inside the apps:

- `apps/designer/src/supabase/*`
- `apps/widget/supabase/client.ts`
- `apps/widget/supabase/index.ts`
- `apps/shopify/lib/supabase*.ts`

Use the root type generation script to refresh `types.ts`:

```bash
npm run supabase:gen:types
```
