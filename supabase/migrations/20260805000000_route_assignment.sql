-- Splits "one shared route per org per day" into one route per assigned
-- employee: route_plans gains assigned_user_id (who drives it) distinct
-- from dispatcher_id (who planned it). Backfill existing active/past plans
-- to their own dispatcher so old rows keep working under the new per-user
-- scoping in /api/routes/plan.
alter table public.route_plans add column if not exists assigned_user_id uuid references auth.users(id) on delete set null;
update public.route_plans set assigned_user_id = dispatcher_id where assigned_user_id is null;
create index if not exists route_plans_assignment on public.route_plans(organization_id, planned_for, assigned_user_id, status);
