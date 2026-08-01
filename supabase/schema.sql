create extension if not exists pgcrypto;
create extension if not exists btree_gist;

do $$ begin create type public.app_role as enum ('admin','dispatcher','office','scanner','viewer'); exception when duplicate_object then null; end $$;

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(), name text not null,
  owner_id uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);
alter table public.organizations add column if not exists contact_email text not null default '';
alter table public.organizations add column if not exists contact_phone text not null default '';
alter table public.organizations add column if not exists postal_address text not null default '';
create table if not exists public.organization_members (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.app_role not null default 'viewer', display_name text not null default '', phone text not null default '',
  created_at timestamptz not null default now(), primary key (organization_id,user_id)
);
create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null, tax_id text not null default '', email text not null default '', phone text not null default '', address text not null default '',
  latitude double precision, longitude double precision, created_at timestamptz not null default now(), unique(organization_id,id)
);
create table if not exists public.vehicles (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  brand text not null, model text not null, registration_number text not null, vin text not null default '', status text not null default 'active',
  created_at timestamptz not null default now(), unique(organization_id,registration_number), unique(organization_id,id)
);
create table if not exists public.vehicle_assignments (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  vehicle_id uuid not null, customer_id uuid not null,
  agreement_number text not null default '', valid_from timestamptz not null, valid_to timestamptz, source text not null default 'manual',
  created_by uuid references auth.users(id) on delete set null, created_at timestamptz not null default now(),
  check(valid_to is null or valid_to > valid_from),
  foreign key(organization_id,vehicle_id) references public.vehicles(organization_id,id) on delete restrict,
  foreign key(organization_id,customer_id) references public.customers(organization_id,id) on delete restrict
);
create index if not exists assignments_vehicle_period on public.vehicle_assignments(vehicle_id,valid_from,valid_to);
alter table public.vehicle_assignments drop constraint if exists vehicle_assignment_no_overlap;
alter table public.vehicle_assignments add constraint vehicle_assignment_no_overlap exclude using gist
  (vehicle_id with =, tstzrange(valid_from,coalesce(valid_to,'infinity'::timestamptz),'[)') with &&);

create table if not exists public.delivery_orders (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  vehicle_id uuid not null, customer_id uuid not null,
  address text not null, latitude double precision not null check(latitude between -90 and 90), longitude double precision not null check(longitude between -180 and 180),
  window_start timestamptz, window_end timestamptz, service_minutes integer not null default 20 check(service_minutes between 0 and 240),
  priority smallint not null default 1 check(priority between 1 and 5), status text not null default 'ready', created_at timestamptz not null default now(),
  unique(organization_id,id),
  foreign key(organization_id,vehicle_id) references public.vehicles(organization_id,id) on delete restrict,
  foreign key(organization_id,customer_id) references public.customers(organization_id,id) on delete restrict
);
create table if not exists public.route_plans (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  planned_for date not null, dispatcher_id uuid references auth.users(id) on delete set null, start_address text not null,
  start_latitude double precision not null, start_longitude double precision not null, status text not null default 'draft',
  optimization_source text not null default 'manual', distance_meters integer, duration_seconds integer,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(organization_id,id)
);
create table if not exists public.route_stops (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  route_plan_id uuid not null, delivery_order_id uuid not null,
  position integer not null check(position>0), planned_arrival timestamptz, status text not null default 'planned', completed_at timestamptz,
  notes text not null default '', unique(route_plan_id,position), unique(route_plan_id,delivery_order_id),
  foreign key(organization_id,route_plan_id) references public.route_plans(organization_id,id) on delete cascade,
  foreign key(organization_id,delivery_order_id) references public.delivery_orders(organization_id,id) on delete restrict
);
create table if not exists public.mandate_documents (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  uploaded_by uuid references auth.users(id) on delete set null, page_count integer not null check(page_count between 1 and 10),
  status text not null default 'uploaded', created_at timestamptz not null default now(), unique(organization_id,id)
);
alter table public.mandate_documents add column if not exists ocr_text text not null default '';
alter table public.mandate_documents add column if not exists registration_number text;
alter table public.mandate_documents add column if not exists event_at date;
-- event_at needs hour-of-day precision so matchVehicleCustomer can tell apart
-- two handovers of the same vehicle on the same calendar day.
alter table public.mandate_documents alter column event_at type timestamptz using event_at::timestamptz;
alter table public.mandate_documents add column if not exists letter_date date;
alter table public.mandate_documents add column if not exists case_number text;
alter table public.mandate_documents add column if not exists sender text;
alter table public.mandate_documents add column if not exists extraction_confidence jsonb not null default '{}'::jsonb;
alter table public.mandate_documents add column if not exists ocr_error text not null default '';
alter table public.mandate_documents add column if not exists processed_at timestamptz;
alter table public.mandate_documents add column if not exists ocr_attempt_count integer not null default 0;
alter table public.mandate_documents add column if not exists ocr_last_attempt_at timestamptz;
alter table public.mandate_documents add column if not exists ocr_next_retry_at timestamptz;
alter table public.mandate_documents add column if not exists responsible_name text not null default '';
alter table public.mandate_documents add column if not exists responsible_tax_id text not null default '';
alter table public.mandate_documents add column if not exists responsible_email text not null default '';
alter table public.mandate_documents add column if not exists confirmed_at timestamptz;
alter table public.mandate_documents add column if not exists confirmed_by uuid references auth.users(id) on delete set null;
alter table public.mandate_documents add column if not exists resolved_at timestamptz;
alter table public.mandate_documents add column if not exists resolved_by uuid references auth.users(id) on delete set null;
alter table public.mandate_documents add column if not exists review_package_sent_at timestamptz;
alter table public.mandate_documents add column if not exists review_package_sent_by uuid references auth.users(id) on delete set null;
alter table public.mandate_documents add column if not exists review_package_email text not null default '';
alter table public.mandate_documents add column if not exists review_package_resend_id text not null default '';
-- Financial data is kept separately from the response deadline: a request to
-- identify the driver is not necessarily a fine payable by the fleet.
alter table public.mandate_documents add column if not exists amount_gross numeric(12,2);
alter table public.mandate_documents add column if not exists currency char(3) not null default 'PLN';
alter table public.mandate_documents add column if not exists payment_due_at date;
alter table public.mandate_documents add column if not exists response_due_at date;
alter table public.mandate_documents add column if not exists financial_status text not null default 'unknown'
  check(financial_status in ('unknown','not_applicable','pending_review','awaiting_payment','settled','cancelled'));
alter table public.mandate_documents add column if not exists amount_confirmed_at timestamptz;
alter table public.mandate_documents add column if not exists amount_confirmed_by uuid references auth.users(id) on delete set null;

create table if not exists public.mandate_status_events (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  document_id uuid not null references public.mandate_documents(id) on delete cascade,
  previous_status text, next_status text not null,
  actor_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create table if not exists public.mandate_document_pages (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  document_id uuid not null, page_number integer not null check(page_number between 1 and 10), storage_path text not null unique,
  original_name text not null, mime_type text not null, size_bytes bigint not null check(size_bytes>0), created_at timestamptz not null default now(),
  unique(document_id,page_number), foreign key(organization_id,document_id) references public.mandate_documents(organization_id,id) on delete cascade
);
create table if not exists public.audit_events (
  id bigint generated always as identity primary key, organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null, action text not null, entity_type text not null, entity_id text not null,
  details jsonb not null default '{}'::jsonb, created_at timestamptz not null default now()
);

create or replace function public.is_org_member(org_id uuid) returns boolean language sql stable security definer set search_path=public as $$
 select exists(select 1 from public.organization_members where organization_id=org_id and user_id=auth.uid()) $$;
create or replace function public.has_org_role(org_id uuid, allowed public.app_role[]) returns boolean language sql stable security definer set search_path=public as $$
 select exists(select 1 from public.organization_members where organization_id=org_id and user_id=auth.uid() and role=any(allowed)) $$;
create or replace function public.bootstrap_organization(company_name text) returns uuid language plpgsql security definer set search_path=public as $$
declare created_id uuid; existing_id uuid;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if exists(select 1 from public.organization_members where user_id=auth.uid()) then raise exception 'User already belongs to an organization'; end if;
  -- A second account may never join an existing fleet through a public RPC.
  -- It must be added by the invitation flow, otherwise any person who signs
  -- up with the public Supabase endpoint could gain office access.
  select id into existing_id from public.organizations order by created_at asc limit 1;
  if existing_id is not null then raise exception 'Invitation required'; end if;
  insert into public.organizations(name,owner_id) values(coalesce(nullif(trim(company_name),''),'Moja firma'),auth.uid()) returning id into created_id;
  insert into public.organization_members(organization_id,user_id,role) values(created_id,auth.uid(),'admin');
  return created_id;
end $$;
revoke all on function public.bootstrap_organization(text) from public;
grant execute on function public.bootstrap_organization(text) to authenticated;

create or replace function public.claim_ocr_job() returns table(id uuid, organization_id uuid) language plpgsql security definer set search_path=public as $$
begin
  return query
  with candidate as (
    select d.id from public.mandate_documents d
    where (
      d.status = 'uploaded'
      or (d.status = 'ocr_failed' and d.ocr_attempt_count < 3 and coalesce(d.ocr_next_retry_at, now()) <= now())
      or (d.status = 'processing' and coalesce(d.ocr_last_attempt_at, d.created_at) < now() - interval '15 minutes')
    )
    order by d.created_at asc
    for update skip locked limit 1
  )
  update public.mandate_documents d set
    status = 'processing', ocr_attempt_count = d.ocr_attempt_count + 1,
    ocr_last_attempt_at = now(), ocr_next_retry_at = now() + interval '5 minutes'
  from candidate c where d.id = c.id
  returning d.id, d.organization_id;
end $$;
revoke all on function public.claim_ocr_job() from public;
grant execute on function public.claim_ocr_job() to service_role;

alter table public.organizations enable row level security; alter table public.organization_members enable row level security;
alter table public.customers enable row level security; alter table public.vehicles enable row level security;
alter table public.vehicle_assignments enable row level security; alter table public.delivery_orders enable row level security;
alter table public.route_plans enable row level security; alter table public.route_stops enable row level security; alter table public.audit_events enable row level security;
alter table public.mandate_documents enable row level security; alter table public.mandate_document_pages enable row level security;
alter table public.mandate_status_events enable row level security;

drop policy if exists organizations_read on public.organizations; drop policy if exists organizations_admin on public.organizations;
drop policy if exists members_read on public.organization_members; drop policy if exists members_admin on public.organization_members;
drop policy if exists customers_read on public.customers; drop policy if exists customers_write on public.customers;
drop policy if exists vehicles_read on public.vehicles; drop policy if exists vehicles_write on public.vehicles;
drop policy if exists assignments_read on public.vehicle_assignments; drop policy if exists assignments_write on public.vehicle_assignments;
drop policy if exists deliveries_read on public.delivery_orders; drop policy if exists deliveries_write on public.delivery_orders;
drop policy if exists plans_read on public.route_plans; drop policy if exists plans_write on public.route_plans;
drop policy if exists stops_read on public.route_stops; drop policy if exists stops_write on public.route_stops;
drop policy if exists documents_read on public.mandate_documents; drop policy if exists documents_write on public.mandate_documents;
drop policy if exists document_pages_read on public.mandate_document_pages; drop policy if exists document_pages_write on public.mandate_document_pages;
drop policy if exists audit_read on public.audit_events; drop policy if exists audit_insert on public.audit_events;
drop policy if exists mandate_status_events_read on public.mandate_status_events;

create policy organizations_read on public.organizations for select using(public.is_org_member(id));
create policy organizations_admin on public.organizations for update using(public.has_org_role(id,array['admin']::public.app_role[]));
create policy members_read on public.organization_members for select using(public.is_org_member(organization_id));
create policy members_admin on public.organization_members for all using(public.has_org_role(organization_id,array['admin']::public.app_role[])) with check(public.has_org_role(organization_id,array['admin']::public.app_role[]));
create policy customers_read on public.customers for select using(public.is_org_member(organization_id));
create policy customers_write on public.customers for all using(public.has_org_role(organization_id,array['admin','dispatcher','office']::public.app_role[])) with check(public.has_org_role(organization_id,array['admin','dispatcher','office']::public.app_role[]));
create policy vehicles_read on public.vehicles for select using(public.is_org_member(organization_id));
create policy vehicles_write on public.vehicles for all using(public.has_org_role(organization_id,array['admin','dispatcher','office']::public.app_role[])) with check(public.has_org_role(organization_id,array['admin','dispatcher','office']::public.app_role[]));
create policy assignments_read on public.vehicle_assignments for select using(public.is_org_member(organization_id));
create policy assignments_write on public.vehicle_assignments for all using(public.has_org_role(organization_id,array['admin','dispatcher','office']::public.app_role[])) with check(public.has_org_role(organization_id,array['admin','dispatcher','office']::public.app_role[]));
create policy deliveries_read on public.delivery_orders for select using(public.is_org_member(organization_id));
create policy deliveries_write on public.delivery_orders for all using(public.has_org_role(organization_id,array['admin','dispatcher']::public.app_role[])) with check(public.has_org_role(organization_id,array['admin','dispatcher']::public.app_role[]));
create policy plans_read on public.route_plans for select using(public.is_org_member(organization_id));
create policy plans_write on public.route_plans for all using(public.has_org_role(organization_id,array['admin','dispatcher']::public.app_role[])) with check(public.has_org_role(organization_id,array['admin','dispatcher']::public.app_role[]));
create policy stops_read on public.route_stops for select using(public.is_org_member(organization_id));
create policy stops_write on public.route_stops for all using(public.has_org_role(organization_id,array['admin','dispatcher']::public.app_role[])) with check(public.has_org_role(organization_id,array['admin','dispatcher']::public.app_role[]));
create policy documents_read on public.mandate_documents for select using(public.has_org_role(organization_id,array['admin','office','scanner','viewer']::public.app_role[]));
create policy documents_write on public.mandate_documents for all using(public.has_org_role(organization_id,array['admin','office','scanner']::public.app_role[])) with check(public.has_org_role(organization_id,array['admin','office','scanner']::public.app_role[]));
create policy document_pages_read on public.mandate_document_pages for select using(public.has_org_role(organization_id,array['admin','office','scanner','viewer']::public.app_role[]));
create policy document_pages_write on public.mandate_document_pages for all using(public.has_org_role(organization_id,array['admin','office','scanner']::public.app_role[])) with check(public.has_org_role(organization_id,array['admin','office','scanner']::public.app_role[]));
create policy audit_read on public.audit_events for select using(public.has_org_role(organization_id,array['admin','dispatcher','office']::public.app_role[]));
create policy audit_insert on public.audit_events for insert with check(public.is_org_member(organization_id) and user_id=auth.uid());
create policy mandate_status_events_read on public.mandate_status_events for select using(public.has_org_role(organization_id,array['admin','office']::public.app_role[]));

do $$ begin create type public.bug_report_status as enum ('nowe','w_trakcie','rozwiazane'); exception when duplicate_object then null; end $$;
create table if not exists public.bug_reports (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  reporter_id uuid not null references auth.users(id) on delete cascade, reporter_email text not null default '',
  description text not null, context text not null default '', status public.bug_report_status not null default 'nowe',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
alter table public.bug_reports add column if not exists attachment_path text not null default '';
alter table public.bug_reports add column if not exists attachment_mime_type text not null default '';
alter table public.bug_reports enable row level security;
drop policy if exists bug_reports_read on public.bug_reports; drop policy if exists bug_reports_insert on public.bug_reports; drop policy if exists bug_reports_update on public.bug_reports;
create policy bug_reports_read on public.bug_reports for select using(public.has_org_role(organization_id,array['admin']::public.app_role[]));
create policy bug_reports_insert on public.bug_reports for insert with check(public.is_org_member(organization_id) and reporter_id=auth.uid());
create policy bug_reports_update on public.bug_reports for update using(public.has_org_role(organization_id,array['admin']::public.app_role[])) with check(public.has_org_role(organization_id,array['admin']::public.app_role[]));

create table if not exists public.drivers (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  first_name text not null default '', last_name text not null default '', phone text not null default '', email text not null default '',
  license_number text not null default '', license_valid_until date, status text not null default 'Dostępny',
  created_at timestamptz not null default now()
);
alter table public.drivers enable row level security;
drop policy if exists drivers_read on public.drivers; drop policy if exists drivers_write on public.drivers;
create policy drivers_read on public.drivers for select using(public.is_org_member(organization_id));
create policy drivers_write on public.drivers for all using(public.has_org_role(organization_id,array['admin','dispatcher','office']::public.app_role[])) with check(public.has_org_role(organization_id,array['admin','dispatcher','office']::public.app_role[]));

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('mandate-documents','mandate-documents',false,15728640,array['application/pdf','image/jpeg','image/png','image/tiff','image/heic','image/heif'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('bug-reports','bug-reports',false,8388608,array['image/png','image/jpeg','image/webp','image/gif'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
