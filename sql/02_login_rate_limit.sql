-- Run AFTER 01_schema.sql in Supabase SQL Editor.
-- Four-digit reviewer PINs require protection against repeated guesses.
-- Keep this table and both RPCs private to the Next.js service-role client.

create table if not exists public.login_attempts (
  key text primary key,
  attempts integer not null default 0,
  window_started_at timestamptz not null default now(),
  blocked_until timestamptz
);
alter table public.login_attempts enable row level security;

create or replace function public.claim_login_attempt(p_key text)
returns boolean
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare v public.login_attempts%rowtype;
begin
  if p_key is null or length(p_key) <> 64 then
    raise exception 'Invalid attempt key';
  end if;
  insert into public.login_attempts(key) values(p_key) on conflict do nothing;
  select * into v from public.login_attempts where key = p_key for update;
  if v.blocked_until is not null and v.blocked_until > now() then
    return false;
  end if;
  if v.window_started_at < now() - interval '15 minutes' then
    update public.login_attempts set attempts=1,window_started_at=now(),blocked_until=null where key=p_key;
    return true;
  end if;
  if v.attempts >= 5 then
    update public.login_attempts set blocked_until=now() + interval '15 minutes' where key=p_key;
    return false;
  end if;
  update public.login_attempts set attempts=attempts+1,blocked_until=null where key=p_key;
  return true;
end;
$$;

create or replace function public.clear_login_attempts(p_key text)
returns void language sql security invoker
set search_path = public, pg_temp
as $$
  delete from public.login_attempts where key=p_key;
$$;

revoke execute on function public.claim_login_attempt(text) from public, anon, authenticated;
revoke execute on function public.clear_login_attempts(text) from public, anon, authenticated;
grant execute on function public.claim_login_attempt(text) to service_role;
grant execute on function public.clear_login_attempts(text) to service_role;
