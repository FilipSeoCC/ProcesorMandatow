-- Product decision: authentication returns to e-mail + password only.
-- Keep the account approval and role checks, but remove every AAL2/MFA
-- condition introduced by 20260811000000_auth_security.sql.

create or replace function public.is_org_member(org_id uuid) returns boolean
language sql stable security definer set search_path=public as $$
  select exists(
    select 1 from public.organization_members
    where organization_id=org_id
      and user_id=auth.uid()
      and status='active'
  )
$$;

create or replace function public.has_org_role(org_id uuid, allowed public.app_role[]) returns boolean
language sql stable security definer set search_path=public as $$
  select exists(
    select 1 from public.organization_members
    where organization_id=org_id
      and user_id=auth.uid()
      and status='active'
      and role=any(allowed)
  )
$$;
