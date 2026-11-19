-- Production Management: initial Supabase schema
-- Target: Supabase PostgreSQL 17+
-- Date: 2026-11-19
--
-- Apply this migration only to a NEW Production Management Supabase project.
-- Do not apply it to PRO_SCAN or another application database.

create extension if not exists pgcrypto;

create or replace function public.pm_current_role()
returns text
language sql
stable
as $$
  select coalesce(auth.jwt() -> 'app_metadata' ->> 'role', 'none');
$$;

create table public.pm_user_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.pm_brands (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null
);

create table public.pm_products (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.pm_brands(id) on delete restrict,
  name text not null,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  unique (brand_id, name),
  unique (id, brand_id)
);

create table public.pm_models (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.pm_products(id) on delete restrict,
  model_number text not null,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  unique (product_id, model_number),
  unique (id, product_id)
);

create table public.pm_production_plans (
  id uuid primary key default gen_random_uuid(),
  legacy_id text unique,
  plan_date date not null,
  shift text not null check (shift in ('Shift 1', 'Shift 2', 'Shift 3')),
  line text not null check (line in ('Line 1', 'Line 2', 'Line 3')),
  brand_id uuid not null references public.pm_brands(id) on delete restrict,
  product_id uuid not null,
  model_id uuid not null,
  planned_qty integer not null check (planned_qty > 0),
  start_time time not null default '09:00',
  end_time time not null default '17:00',
  supervisor_name text,
  supervisor_user_id uuid references auth.users(id) on delete set null,
  status text not null default 'draft'
    check (status in ('draft', 'published', 'completed')),
  created_by uuid not null default auth.uid() references auth.users(id),
  published_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (product_id, brand_id)
    references public.pm_products(id, brand_id) on delete restrict,
  foreign key (model_id, product_id)
    references public.pm_models(id, product_id) on delete restrict,
  check (end_time > start_time)
);

create table public.pm_plan_hour_targets (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.pm_production_plans(id) on delete cascade,
  hour_index smallint not null check (hour_index between 0 and 7),
  hour_label text not null,
  planned_qty integer not null check (planned_qty >= 0),
  created_at timestamptz not null default now(),
  unique (plan_id, hour_index),
  unique (id, plan_id, hour_index)
);

create table public.pm_hourly_production (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null,
  hour_index smallint not null check (hour_index between 0 and 7),
  actual_qty integer not null check (actual_qty >= 0),
  rejected_qty integer not null default 0 check (rejected_qty >= 0 and rejected_qty <= actual_qty),
  serial_start text,
  serial_end text,
  rejection_reason text,
  remarks text,
  recorded_by uuid not null default auth.uid() references auth.users(id),
  recorded_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (plan_id, hour_index),
  foreign key (plan_id, hour_index)
    references public.pm_plan_hour_targets(plan_id, hour_index) on delete restrict,
  check (actual_qty = 0 or (nullif(btrim(serial_start), '') is not null and nullif(btrim(serial_end), '') is not null)),
  check (rejected_qty = 0 or nullif(btrim(rejection_reason), '') is not null)
);

create table public.pm_rework_units (
  id uuid primary key default gen_random_uuid(),
  hourly_production_id uuid not null references public.pm_hourly_production(id) on delete restrict,
  unit_number integer not null check (unit_number > 0),
  serial_number text,
  original_reason text not null,
  status text not null default 'pending'
    check (status in ('pending', 'completed', 'finally_rejected')),
  resolution_remark text,
  resolved_by uuid references auth.users(id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  unique (hourly_production_id, unit_number),
  check (
    (status = 'pending' and resolved_at is null)
    or
    (status in ('completed', 'finally_rejected')
      and nullif(btrim(resolution_remark), '') is not null
      and resolved_at is not null)
  )
);

create index pm_plans_date_status_idx
  on public.pm_production_plans(plan_date, status);
create index pm_plans_line_shift_idx
  on public.pm_production_plans(line, shift);
create index pm_hourly_plan_idx
  on public.pm_hourly_production(plan_id, hour_index);
create index pm_rework_status_idx
  on public.pm_rework_units(status, hourly_production_id);

create or replace function public.pm_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger pm_profiles_updated_at
before update on public.pm_user_profiles
for each row execute function public.pm_set_updated_at();

create trigger pm_plans_updated_at
before update on public.pm_production_plans
for each row execute function public.pm_set_updated_at();

create trigger pm_hourly_updated_at
before update on public.pm_hourly_production
for each row execute function public.pm_set_updated_at();

create or replace function public.pm_validate_hourly_entry()
returns trigger
language plpgsql
as $$
declare
  v_plan_status text;
  v_target_qty integer;
begin
  select p.status, t.planned_qty
    into v_plan_status, v_target_qty
  from public.pm_production_plans p
  join public.pm_plan_hour_targets t
    on t.plan_id = p.id and t.hour_index = new.hour_index
  where p.id = new.plan_id;

  if not found then
    raise exception 'Production plan hour target was not found';
  end if;

  if v_plan_status not in ('published', 'completed') then
    raise exception 'Hourly production can only be recorded against a published plan';
  end if;

  if new.actual_qty > v_target_qty then
    raise exception 'Actual quantity cannot exceed the hourly planned quantity';
  end if;

  if new.rejected_qty > new.actual_qty then
    raise exception 'Rejected quantity cannot exceed actual quantity';
  end if;

  if new.actual_qty > 0
     and (nullif(btrim(new.serial_start), '') is null
       or nullif(btrim(new.serial_end), '') is null) then
    raise exception 'Serial start and end are required when actual quantity is greater than zero';
  end if;

  if new.rejected_qty > 0 and nullif(btrim(new.rejection_reason), '') is null then
    raise exception 'A rejection reason is required when rejected quantity is greater than zero';
  end if;

  if tg_op = 'UPDATE' and new.recorded_by <> old.recorded_by then
    raise exception 'The original hourly record owner cannot be changed';
  end if;

  return new;
end;
$$;

create trigger pm_hourly_validate
before insert or update on public.pm_hourly_production
for each row execute function public.pm_validate_hourly_entry();

-- One row per rejected unit. The trigger preserves resolved rows and only
-- removes pending rows when an hourly rejection quantity is reduced.
create or replace function public.pm_sync_rework_units()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_total integer;
  v_resolved integer;
  v_max_unit integer;
  v_needed integer;
begin
  select count(*),
         count(*) filter (where status <> 'pending'),
         coalesce(max(unit_number), 0)
    into v_total, v_resolved, v_max_unit
  from public.pm_rework_units
  where hourly_production_id = new.id;

  if new.rejected_qty < v_resolved then
    raise exception 'Rejected quantity cannot be reduced below the number of already resolved units';
  end if;

  if new.rejected_qty < v_total then
    delete from public.pm_rework_units
    where id in (
      select id
      from public.pm_rework_units
      where hourly_production_id = new.id
        and status = 'pending'
      order by unit_number desc
      limit (v_total - new.rejected_qty)
    );

    select count(*), coalesce(max(unit_number), 0)
      into v_total, v_max_unit
    from public.pm_rework_units
    where hourly_production_id = new.id;
  end if;

  v_needed := new.rejected_qty - v_total;

  if v_needed > 0 then
    insert into public.pm_rework_units (
      hourly_production_id, unit_number, original_reason
    )
    select new.id,
           v_max_unit + series.n,
           coalesce(nullif(btrim(new.rejection_reason), ''), 'Unspecified rejection')
    from generate_series(1, v_needed) as series(n);
  end if;

  return new;
end;
$$;

revoke all on function public.pm_sync_rework_units() from public, anon, authenticated;

create trigger pm_hourly_sync_rework
after insert or update of rejected_qty on public.pm_hourly_production
for each row execute function public.pm_sync_rework_units();

create or replace function public.pm_guard_rework_resolution()
returns trigger
language plpgsql
as $$
begin
  if old.status <> 'pending' then
    raise exception 'Resolved rejection records are locked and cannot be changed';
  end if;

  if new.status not in ('completed', 'finally_rejected') then
    raise exception 'A pending rejection must be resolved as completed or finally rejected';
  end if;

  if nullif(btrim(new.resolution_remark), '') is null then
    raise exception 'A resolution remark is required';
  end if;

  if new.hourly_production_id <> old.hourly_production_id
     or new.unit_number <> old.unit_number
     or new.original_reason <> old.original_reason
     or new.serial_number is distinct from old.serial_number then
    raise exception 'Original rejection details are immutable';
  end if;

  new.resolved_by := auth.uid();
  new.resolved_at := now();
  return new;
end;
$$;

create trigger pm_rework_resolution_guard
before update on public.pm_rework_units
for each row execute function public.pm_guard_rework_resolution();

-- Status transitions are performed only through these checked RPC functions.
create or replace function public.pm_publish_plan(p_plan_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_total integer;
  v_hours integer;
begin
  if auth.uid() is null or public.pm_current_role() not in ('admin', 'supervisor') then
    raise exception 'Only an authenticated admin or supervisor can publish a plan';
  end if;

  select count(*), coalesce(sum(planned_qty), 0)
    into v_hours, v_total
  from public.pm_plan_hour_targets
  where plan_id = p_plan_id;

  if v_hours <> 8 then
    raise exception 'Exactly eight hourly targets are required before publishing';
  end if;

  update public.pm_production_plans
  set status = 'published', published_at = now()
  where id = p_plan_id and status = 'draft' and planned_qty = v_total;

  if not found then
    raise exception 'Plan not found, not in Draft status, or hourly targets do not equal the shift target';
  end if;
end;
$$;

create or replace function public.pm_close_plan(p_plan_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_missing integer;
begin
  if auth.uid() is null or public.pm_current_role() not in ('admin', 'supervisor', 'operator') then
    raise exception 'Not authorised to close this production plan';
  end if;

  select count(*)
    into v_missing
  from public.pm_plan_hour_targets t
  left join public.pm_hourly_production h
    on h.plan_id = t.plan_id and h.hour_index = t.hour_index
  where t.plan_id = p_plan_id
    and h.id is null;

  if v_missing > 0 then
    raise exception 'All scheduled hourly records must be entered before shift close';
  end if;

  update public.pm_production_plans
  set status = 'completed', completed_at = now()
  where id = p_plan_id and status = 'published';

  if not found then
    raise exception 'Plan not found or is not currently Published';
  end if;
end;
$$;

revoke all on function public.pm_publish_plan(uuid) from public, anon;
revoke all on function public.pm_close_plan(uuid) from public, anon;
grant execute on function public.pm_publish_plan(uuid) to authenticated;
grant execute on function public.pm_close_plan(uuid) to authenticated;

-- Row Level Security
alter table public.pm_user_profiles enable row level security;
alter table public.pm_brands enable row level security;
alter table public.pm_products enable row level security;
alter table public.pm_models enable row level security;
alter table public.pm_production_plans enable row level security;
alter table public.pm_plan_hour_targets enable row level security;
alter table public.pm_hourly_production enable row level security;
alter table public.pm_rework_units enable row level security;

create policy "profile_select_self_or_manager"
on public.pm_user_profiles for select to authenticated
using (id = (select auth.uid()) or public.pm_current_role() in ('admin', 'supervisor'));

create policy "profile_insert_self"
on public.pm_user_profiles for insert to authenticated
with check (id = (select auth.uid()));

create policy "profile_update_self"
on public.pm_user_profiles for update to authenticated
using (id = (select auth.uid()))
with check (id = (select auth.uid()));

create policy "catalog_read_authenticated"
on public.pm_brands for select to authenticated using (true);
create policy "catalog_write_managers"
on public.pm_brands for all to authenticated
using (public.pm_current_role() in ('admin', 'supervisor'))
with check (public.pm_current_role() in ('admin', 'supervisor'));

create policy "products_read_authenticated"
on public.pm_products for select to authenticated using (true);
create policy "products_write_managers"
on public.pm_products for all to authenticated
using (public.pm_current_role() in ('admin', 'supervisor'))
with check (public.pm_current_role() in ('admin', 'supervisor'));

create policy "models_read_authenticated"
on public.pm_models for select to authenticated using (true);
create policy "models_write_managers"
on public.pm_models for all to authenticated
using (public.pm_current_role() in ('admin', 'supervisor'))
with check (public.pm_current_role() in ('admin', 'supervisor'));

create policy "plans_read_visible"
on public.pm_production_plans for select to authenticated
using (
  status in ('published', 'completed')
  or public.pm_current_role() in ('admin', 'supervisor')
);

create policy "plans_insert_draft"
on public.pm_production_plans for insert to authenticated
with check (
  public.pm_current_role() in ('admin', 'supervisor')
  and status = 'draft'
  and created_by = (select auth.uid())
);

create policy "plans_update_draft"
on public.pm_production_plans for update to authenticated
using (
  public.pm_current_role() in ('admin', 'supervisor')
  and status = 'draft'
)
with check (
  public.pm_current_role() in ('admin', 'supervisor')
  and status = 'draft'
);

create policy "targets_read_visible"
on public.pm_plan_hour_targets for select to authenticated
using (
  exists (
    select 1 from public.pm_production_plans p
    where p.id = plan_id
  )
);

create policy "targets_insert_draft"
on public.pm_plan_hour_targets for insert to authenticated
with check (
  public.pm_current_role() in ('admin', 'supervisor')
  and exists (
    select 1 from public.pm_production_plans p
    where p.id = plan_id and p.status = 'draft'
  )
);

create policy "targets_update_draft"
on public.pm_plan_hour_targets for update to authenticated
using (
  public.pm_current_role() in ('admin', 'supervisor')
  and exists (
    select 1 from public.pm_production_plans p
    where p.id = plan_id and p.status = 'draft'
  )
)
with check (
  public.pm_current_role() in ('admin', 'supervisor')
  and exists (
    select 1 from public.pm_production_plans p
    where p.id = plan_id and p.status = 'draft'
  )
);

create policy "targets_delete_draft"
on public.pm_plan_hour_targets for delete to authenticated
using (
  public.pm_current_role() in ('admin', 'supervisor')
  and exists (
    select 1 from public.pm_production_plans p
    where p.id = plan_id and p.status = 'draft'
  )
);

create policy "hourly_read_visible"
on public.pm_hourly_production for select to authenticated
using (
  exists (
    select 1 from public.pm_production_plans p
    where p.id = plan_id
  )
);

create policy "hourly_insert_published"
on public.pm_hourly_production for insert to authenticated
with check (
  recorded_by = (select auth.uid())
  and exists (
    select 1 from public.pm_production_plans p
    where p.id = plan_id and p.status = 'published'
  )
);

create policy "hourly_update_owner_or_manager"
on public.pm_hourly_production for update to authenticated
using (
  public.pm_current_role() in ('admin', 'supervisor')
  or (
    recorded_by = (select auth.uid())
    and public.pm_current_role() = 'operator'
    and exists (
      select 1 from public.pm_production_plans p
      where p.id = plan_id and p.status = 'published'
    )
  )
)
with check (
  public.pm_current_role() in ('admin', 'supervisor')
  or (
    recorded_by = (select auth.uid())
    and public.pm_current_role() = 'operator'
    and exists (
      select 1 from public.pm_production_plans p
      where p.id = plan_id and p.status = 'published'
    )
  )
);

create policy "rework_read_visible"
on public.pm_rework_units for select to authenticated
using (
  public.pm_current_role() in ('admin', 'supervisor')
  or exists (
    select 1
    from public.pm_hourly_production h
    join public.pm_production_plans p on p.id = h.plan_id
    where h.id = hourly_production_id
      and p.status in ('published', 'completed')
  )
);

create policy "rework_resolve_pending"
on public.pm_rework_units for update to authenticated
using (
  status = 'pending'
  and public.pm_current_role() in ('admin', 'supervisor', 'operator')
)
with check (
  status in ('completed', 'finally_rejected')
  and nullif(btrim(resolution_remark), '') is not null
  and public.pm_current_role() in ('admin', 'supervisor', 'operator')
);

-- Explicit Data API grants. RLS above controls which rows are accessible.
revoke all on public.pm_user_profiles from anon, authenticated;
revoke all on public.pm_brands, public.pm_products, public.pm_models from anon, authenticated;
revoke all on public.pm_production_plans from anon, authenticated;
revoke all on public.pm_plan_hour_targets from anon, authenticated;
revoke all on public.pm_hourly_production from anon, authenticated;
revoke all on public.pm_rework_units from anon, authenticated;

grant select on public.pm_user_profiles to authenticated;
grant insert (id, full_name) on public.pm_user_profiles to authenticated;
grant update (full_name) on public.pm_user_profiles to authenticated;

grant select, insert, update, delete on public.pm_brands, public.pm_products, public.pm_models to authenticated;

grant select, insert on public.pm_production_plans to authenticated;
grant update (
  plan_date, shift, line, brand_id, product_id, model_id,
  planned_qty, start_time, end_time, supervisor_name, supervisor_user_id
) on public.pm_production_plans to authenticated;

grant select, insert, update, delete on public.pm_plan_hour_targets to authenticated;

grant select, insert on public.pm_hourly_production to authenticated;
grant update (
  actual_qty, rejected_qty, serial_start, serial_end, rejection_reason, remarks
) on public.pm_hourly_production to authenticated;

grant select on public.pm_rework_units to authenticated;
grant update (status, resolution_remark) on public.pm_rework_units to authenticated;

-- Report view uses the caller's RLS permissions on the underlying tables.
create or replace view public.pm_production_plan_report
with (security_invoker = true)
as
select
  p.id as plan_id,
  p.legacy_id,
  p.plan_date,
  p.shift,
  p.line,
  b.name as brand,
  pr.name as product,
  m.model_number,
  p.status,
  p.planned_qty,
  coalesce(sum(h.actual_qty), 0)::integer as actual_qty,
  coalesce(sum(h.rejected_qty), 0)::integer as rejected_qty,
  (coalesce(sum(h.actual_qty), 0) - coalesce(sum(h.rejected_qty), 0))::integer as accepted_qty,
  coalesce((
    select count(*)::integer
    from public.pm_rework_units ru
    join public.pm_hourly_production hx on hx.id = ru.hourly_production_id
    where hx.plan_id = p.id and ru.status = 'completed'
  ), 0) as rework_completed_qty,
  coalesce((
    select count(*)::integer
    from public.pm_rework_units ru
    join public.pm_hourly_production hx on hx.id = ru.hourly_production_id
    where hx.plan_id = p.id and ru.status = 'finally_rejected'
  ), 0) as finally_rejected_qty
from public.pm_production_plans p
join public.pm_brands b on b.id = p.brand_id
join public.pm_products pr on pr.id = p.product_id
join public.pm_models m on m.id = p.model_id
left join public.pm_hourly_production h on h.plan_id = p.id
group by p.id, b.name, pr.name, m.model_number;

grant select on public.pm_production_plan_report to authenticated;

comment on table public.pm_production_plans is
  'Production plans. Drafts are editable; status changes use pm_publish_plan and pm_close_plan RPCs.';
comment on table public.pm_hourly_production is
  'One actual production entry per plan/hour. Actual quantity includes rejected units.';
comment on table public.pm_rework_units is
  'One immutable original rejection record per rejected unit; resolved records cannot be edited.';
