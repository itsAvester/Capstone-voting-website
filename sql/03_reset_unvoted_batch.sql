-- DANGER: this clears OLD sampled observations and assignments.
-- Use ONLY if all votes are empty and the reviewer site is offline.
-- Safeguard: aborts with error and rolls back if even one vote exists.
-- This does not change reviewer names, the schema, or PINs.

begin;
lock table public.votes, public.assignments, public.observations in access exclusive mode;
do $$
begin
  if exists (select 1 from public.votes) then
    raise exception 'STOP: votes already exist. Nothing will be deleted. Use a separate Supabase project or preserve the old study.';
  end if;
end;
$$;

delete from public.assignments;
delete from public.observations;
commit;
