create table if not exists public.auth_rate_limits (
  scope text not null,
  key_hash text not null,
  window_started_at timestamptz not null default now(),
  attempts integer not null default 0 check (attempts >= 0),
  updated_at timestamptz not null default now(),
  primary key (scope, key_hash)
);

alter table public.auth_rate_limits enable row level security;

create or replace function public.consume_auth_rate_limit(
  p_scope text,
  p_key_hash text,
  p_limit integer,
  p_window_seconds integer
) returns table(allowed boolean, retry_after_seconds integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  current_attempts integer;
  current_window timestamptz;
  current_time timestamptz := clock_timestamp();
begin
  if p_limit < 1 or p_window_seconds < 1 or length(p_scope) > 80 or length(p_key_hash) <> 64 then
    raise exception 'Invalid rate-limit parameters';
  end if;

  insert into public.auth_rate_limits as existing(
    scope, key_hash, window_started_at, attempts, updated_at
  ) values (p_scope, p_key_hash, current_time, 1, current_time)
  on conflict(scope, key_hash) do update set
    attempts = case
      when existing.window_started_at + make_interval(secs => p_window_seconds) <= current_time then 1
      else existing.attempts + 1
    end,
    window_started_at = case
      when existing.window_started_at + make_interval(secs => p_window_seconds) <= current_time then current_time
      else existing.window_started_at
    end,
    updated_at = current_time
  returning attempts, window_started_at into current_attempts, current_window;

  return query select
    current_attempts <= p_limit,
    case
      when current_attempts <= p_limit then 0
      else greatest(1, ceil(extract(epoch from (
        current_window + make_interval(secs => p_window_seconds) - current_time
      )))::integer)
    end;
end;
$$;

revoke all on public.auth_rate_limits from anon, authenticated;
grant select, insert, update, delete on public.auth_rate_limits to service_role;
revoke all on function public.consume_auth_rate_limit(text,text,integer,integer) from public, anon, authenticated;
grant execute on function public.consume_auth_rate_limit(text,text,integer,integer) to service_role;

-- Privileged accounts must present an AAL2 token. Regular workers remain on
-- password authentication so rollout does not block day-to-day scanning.
create or replace function public.is_org_member(org_id uuid) returns boolean
language sql stable security definer set search_path=public as $$
  select exists(
    select 1 from public.organization_members
    where organization_id=org_id
      and user_id=auth.uid()
      and status='active'
      and (
        coalesce(auth.jwt()->>'aal','aal1')='aal2'
        or (
          role not in ('admin','boss')
          and not exists(
            select 1 from auth.mfa_factors
            where user_id=auth.uid() and status='verified'
          )
        )
      )
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
      and (
        coalesce(auth.jwt()->>'aal','aal1')='aal2'
        or (
          role not in ('admin','boss')
          and not exists(
            select 1 from auth.mfa_factors
            where user_id=auth.uid() and status='verified'
          )
        )
      )
  )
$$;
