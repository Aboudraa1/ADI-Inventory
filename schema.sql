-- Run once in Supabase SQL editor. Create users in Authentication separately.
create extension if not exists pgcrypto;
create table if not exists public.profiles (
 user_id uuid primary key references auth.users(id) on delete cascade,
 role text not null check(role in ('staff','admin')) default 'staff',
 display_name text not null default 'Staff'
);
create table if not exists public.categories (
 id uuid primary key default gen_random_uuid(), name text not null unique, active boolean not null default true
);
create table if not exists public.items (
 id uuid primary key default gen_random_uuid(), item_no text not null unique,
 description text not null, barcode text, category_id uuid not null references public.categories(id),
 active boolean not null default true, created_at timestamptz not null default now()
);
create unique index if not exists items_barcode_unique on public.items(barcode) where barcode is not null and barcode <> '';
create table if not exists public.count_sessions (
 id uuid primary key default gen_random_uuid(), category_id uuid not null references public.categories(id),
 created_by uuid not null default auth.uid() references auth.users(id), created_at timestamptz not null default now(),
 status text not null default 'open' check(status in ('open','closed'))
);
create table if not exists public.count_entries (
 id uuid primary key default gen_random_uuid(), session_id uuid not null references public.count_sessions(id),
 item_id uuid not null references public.items(id), qty numeric(14,3) not null check(qty >= 0),
 created_by uuid not null default auth.uid() references auth.users(id), created_at timestamptz not null default now(),
 unique(session_id,item_id)
);
create table if not exists public.stock_rules (
 item_id uuid primary key references public.items(id) on delete cascade,
 min_qty numeric(14,3) not null default 0 check(min_qty >= 0),
 max_qty numeric(14,3) not null default 0 check(max_qty >= min_qty),
 enabled boolean not null default false
);
create table if not exists public.reorder_lines (
 id uuid primary key default gen_random_uuid(), session_id uuid not null references public.count_sessions(id),
 item_id uuid not null references public.items(id), counted_qty numeric(14,3) not null,
 suggested_qty numeric(14,3) not null check(suggested_qty >= 0),
 order_qty numeric(14,3) not null check(order_qty >= 0),
 status text not null default 'draft' check(status in ('draft','approved','cancelled')),
 created_at timestamptz not null default now(), unique(session_id,item_id)
);
create or replace function public.is_admin() returns boolean language sql stable security definer set search_path = '' as $$
 select exists(select 1 from public.profiles p where p.user_id=auth.uid() and p.role='admin');
$$;
create or replace function public.is_staff() returns boolean language sql stable security definer set search_path = '' as $$
 select exists(select 1 from public.profiles p where p.user_id=auth.uid());
$$;
create or replace function public.record_count(p_session uuid,p_item uuid,p_qty numeric)
returns void language plpgsql security definer set search_path = '' as $$
declare s public.count_sessions%rowtype;
begin
 if not public.is_staff() then raise exception 'Unauthorized'; end if;
 if p_qty is null or p_qty < 0 then raise exception 'Invalid quantity'; end if;
 select * into s from public.count_sessions where id=p_session for update;
 if not found or s.status <> 'open' or (s.created_by<>auth.uid() and not public.is_admin()) then raise exception 'Session unavailable'; end if;
 if not exists(select 1 from public.items where id=p_item and category_id=s.category_id and active) then raise exception 'Invalid item'; end if;
 insert into public.count_entries(session_id,item_id,qty,created_by) values(p_session,p_item,p_qty,auth.uid());
end; $$;
create or replace function public.close_count_session(p_session uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare s public.count_sessions%rowtype;
begin
 if not public.is_admin() then raise exception 'Admin only'; end if;
 select * into s from public.count_sessions where id=p_session for update;
 if not found or s.status<>'open' then raise exception 'Session unavailable'; end if;
 insert into public.reorder_lines(session_id,item_id,counted_qty,suggested_qty,order_qty)
 select p_session,e.item_id,e.qty,greatest(r.max_qty-e.qty,0),greatest(r.max_qty-e.qty,0)
 from public.count_entries e join public.stock_rules r on r.item_id=e.item_id
 where e.session_id=p_session and r.enabled and e.qty<r.min_qty
 on conflict(session_id,item_id) do nothing;
 update public.count_sessions set status='closed' where id=p_session;
end; $$;
-- Explicit grants: never allow client writes to count_entries or profile roles.
revoke all on public.profiles,public.categories,public.items,public.count_sessions,public.count_entries,public.stock_rules,public.reorder_lines from anon;
grant select on public.profiles,public.categories,public.items,public.count_sessions,public.count_entries,public.stock_rules,public.reorder_lines to authenticated;
grant insert on public.count_sessions to authenticated;
grant insert,update on public.categories,public.items,public.stock_rules,public.reorder_lines to authenticated;
grant execute on function public.record_count(uuid,uuid,numeric),public.close_count_session(uuid) to authenticated;
revoke execute on function public.record_count(uuid,uuid,numeric),public.close_count_session(uuid) from public,anon;
alter table public.profiles enable row level security;
alter table public.categories enable row level security;
alter table public.items enable row level security;
alter table public.count_sessions enable row level security;
alter table public.count_entries enable row level security;
alter table public.stock_rules enable row level security;
alter table public.reorder_lines enable row level security;
create policy "profile own or admin" on public.profiles for select to authenticated using(user_id=auth.uid() or public.is_admin());
create policy "categories view" on public.categories for select to authenticated using(public.is_staff());
create policy "categories admin insert" on public.categories for insert to authenticated with check(public.is_admin());
create policy "categories admin update" on public.categories for update to authenticated using(public.is_admin()) with check(public.is_admin());
create policy "items view" on public.items for select to authenticated using(public.is_staff());
create policy "items admin insert" on public.items for insert to authenticated with check(public.is_admin());
create policy "items admin update" on public.items for update to authenticated using(public.is_admin()) with check(public.is_admin());
create policy "sessions view" on public.count_sessions for select to authenticated using(created_by=auth.uid() or public.is_admin());
create policy "sessions insert" on public.count_sessions for insert to authenticated with check(public.is_staff() and created_by=auth.uid() and status='open');
create policy "entries view" on public.count_entries for select to authenticated using(public.is_admin() or exists(select 1 from public.count_sessions s where s.id=session_id and s.created_by=auth.uid()));
create policy "rules view" on public.stock_rules for select to authenticated using(public.is_admin());
create policy "rules insert" on public.stock_rules for insert to authenticated with check(public.is_admin());
create policy "rules update" on public.stock_rules for update to authenticated using(public.is_admin()) with check(public.is_admin());
create policy "reorder view" on public.reorder_lines for select to authenticated using(public.is_admin());
create policy "reorder update" on public.reorder_lines for update to authenticated using(public.is_admin()) with check(public.is_admin());
-- Admin bootstrap: after creating auth users, execute with their real UUIDs:
-- insert into public.profiles(user_id,role,display_name) values ('ADMIN-USER-UUID','admin','Administrator');
-- insert into public.profiles(user_id,role,display_name) values ('STAFF-USER-UUID','staff','Inventory Team');
