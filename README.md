# Production Management — G-ScanLT

This repository is the development/staging project for the Production Management application.

## Current baseline

- UI baseline: Production Management V6.1 (individual rework resolution).
- V6.1 is currently a standalone HTML prototype and stores data in the browser's \`localStorage\` key \`productionManagementV4\`.
- The Supabase schema in \`supabase/migrations\` is the first backend migration.
- The V6.1 UI source HTML is still maintained in the separately delivered V6.1 prototype archive and has **not yet been committed to this repository**. The backend migration in this repository is not connected to that UI yet. Do not use the standalone prototype for live multi-user production.

## Stack

- GitHub: source control.
- Supabase Free: staging PostgreSQL database and Auth.
- Vercel Hobby: staging preview only, subject to its current plan terms and limits.

## Database setup

1. Create a separate Supabase project named \`G-ScanLT-TEST\` in the intended organisation and choose a nearby region (for India, compare Mumbai \`ap-south-1\` and Singapore \`ap-southeast-1\` latency before deciding).
2. In Supabase SQL Editor, run \`supabase/migrations/20261119000000_initial_production_management.sql\`.
3. Optionally run \`supabase/seed.sql\` to insert the demo product catalogue.
4. Create test users in Supabase Authentication.
5. Assign a role using **server-side Supabase Auth Admin API only**. Supported \`app_metadata.role\` values: \`admin\`, \`supervisor\`, \`operator\`. Never place a service-role key in browser code. After changing app metadata, refresh the user's session so the JWT contains the new role.
6. Have each user create their own profile row in \`pm_user_profiles\` (or add it from a trusted admin process).

Example server-side role assignment (run only in a trusted Node/server environment with the service-role key):

\`\`\`js
await supabase.auth.admin.updateUserById(userId, {
  app_metadata: { role: "operator" }
});
\`\`\`

## Database model

- \`pm_brands → pm_products → pm_models\`: editable cascading product master.
- \`pm_production_plans\`: draft, published and completed plans.
- \`pm_plan_hour_targets\`: eight hourly planned quantities for each V6.1 shift.
- \`pm_hourly_production\`: actual, rejected, serial range and remarks for each plan/hour.
- \`pm_rework_units\`: one row per rejected unit; original reason is retained and completed/finally-rejected units lock.
- \`pm_production_plan_report\`: RLS-aware reporting view. Actual includes rejected units; accepted = actual − rejected.

Publishing and closing are database-validated through:
- \`pm_publish_plan(plan_id)\`: admin/supervisor only; requires eight hourly targets summing to the plan quantity.
- \`pm_close_plan(plan_id)\`: requires every planned hour to have an hourly production entry.

## V6.1 migration approach

See [V6.1 data mapping](docs/v6.1-migration-map.md) before importing any browser data. Each device/browser may have its own localStorage contents. Export and reconcile those separately; do not assume the prototype's sample data is real production history.

## Security and staging guardrails

- RLS is enabled on every exposed table.
- Role checks use the JWT \`app_metadata\` claim, not user-editable \`user_metadata\`.
- A browser may contain only the Supabase project URL and publishable key.
- Never commit passwords, access tokens, publishable keys tied to private environments, or the service-role/secret key.
- Test with one account per role and verify that operators cannot create or publish plans, modify catalog masters, or alter resolved rejection records.
- Supabase Free is for development/testing. Configure independent exports before any live use; production use requires a plan and backup review appropriate to the factory's uptime requirements.

## Next implementation milestones

1. Create the isolated Supabase staging project and apply this SQL.
2. Verify RLS and database constraints with three test roles.
3. Replace V6.1 localStorage reads/writes with a Supabase repository layer.
4. Add login/logout and role-aware navigation.
5. Migrate approved V6.1 browser exports into normalized tables.
6. Test concurrent operator entries, shift closing, rework locking and report totals.
7. Connect the GitHub repository to a Vercel staging project.

See [staging test checklist](docs/STAGING_TEST_CHECKLIST.md).
