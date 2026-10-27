-- Search Arena blind annotation site. Execute ONCE in Supabase SQL Editor.
-- Data is private by default: browser clients have no direct access.
-- Next.js Route Handlers use the service-role key, on the SERVER ONLY.

create table if not exists public.reviewers (
  id text primary key check (id in ('reviewer_1','reviewer_2','reviewer_3','reviewer_4','reviewer_5')),
  display_name text not null
);

create table if not exists public.observations (
  id text primary key,
  source_row_id integer not null unique,
  primary_intent text not null default 'Unknown',
  languages jsonb,
  prompt text not null,
  response_a text not null,
  response_b text not null,
  conversation_a jsonb not null default '[]'::jsonb,
  conversation_b jsonb not null default '[]'::jsonb,
  status text not null default 'open' check(status in ('open','finalized','unresolved')),
  consensus text check (consensus in ('a','b','tie','both_bad')),
  finalized_at timestamptz,
  created_at timestamptz not null default now(),
  constraint status_consensus_valid check (
    (status = 'finalized' and consensus is not null) or
    (status <> 'finalized' and consensus is null)
  )
);

create table if not exists public.assignments (
  observation_id text not null references public.observations(id) on delete cascade,
  reviewer_id text not null references public.reviewers(id),
  stage text not null check (stage in ('initial','tie_break','replacement')),
  left_response text not null check(left_response in ('a','b')),
  right_response text not null check(right_response in ('a','b')),
  state text not null default 'pending' check(state in ('pending','completed')),
  created_at timestamptz not null default now(),
  primary key (observation_id, reviewer_id),
  constraint distinct_sides check (left_response <> right_response)
);
create index if not exists assignments_next_idx on public.assignments(reviewer_id, state, created_at);

create table if not exists public.votes (
  observation_id text not null,
  reviewer_id text not null,
  choice text not null check (choice in ('a','b','tie','both_bad','skip')),
  created_at timestamptz not null default now(),
  primary key (observation_id, reviewer_id),
  foreign key (observation_id, reviewer_id)
    references public.assignments(observation_id, reviewer_id)
);
create index if not exists votes_obs_idx on public.votes(observation_id);

insert into public.reviewers (id, display_name) values
  ('reviewer_1','Reviewer 1'),
  ('reviewer_2','Reviewer 2'),
  ('reviewer_3','Reviewer 3'),
  ('reviewer_4','Reviewer 4'),
  ('reviewer_5','Reviewer 5')
on conflict (id) do nothing;

-- RLS prevents the public anon key from fetching observations/votes.
alter table public.reviewers enable row level security;
alter table public.observations enable row level security;
alter table public.assignments enable row level security;
alter table public.votes enable row level security;
-- No SELECT/INSERT/UPDATE/DELETE policies for anon or authenticated roles.
-- Supabase's service_role (used only on the server) bypasses RLS.

-- Avoid granting the voting RPC to arbitrary public API callers.
-- Route Handlers call this from the server using service_role only.
create or replace function public.submit_review_vote(
  p_observation_id text,
  p_reviewer_id text,
  p_choice text
) returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_status text;
  v_assigned public.assignments%rowtype;
  v_valid integer;
  v_top_count integer;
  v_top_choice text;
  v_next_reviewer text;
  v_left text;
  v_skip_count integer;
begin
  if p_choice not in ('a','b','tie','both_bad','skip') or p_choice is null then
    raise exception 'Invalid vote value';
  end if;

  -- Serializes votes for a single observation, preventing simultaneous decisions
  -- from creating multiple tie-break assignments or overwriting a consensus.
  select status into v_status
    from public.observations where id = p_observation_id for update;
  if not found then raise exception 'Unknown observation'; end if;
  if v_status <> 'open' then raise exception 'Observation already closed'; end if;

  select * into v_assigned from public.assignments
    where observation_id = p_observation_id and reviewer_id = p_reviewer_id
    for update;
  if not found then raise exception 'Not assigned to this observation'; end if;
  if v_assigned.state <> 'pending' then raise exception 'Already voted'; end if;

  insert into public.votes (observation_id, reviewer_id, choice)
    values (p_observation_id, p_reviewer_id, p_choice);
  update public.assignments set state='completed'
    where observation_id=p_observation_id and reviewer_id=p_reviewer_id;

  -- 'skip' is abstention, not a third category of preference.
  select count(*) into v_valid from public.votes
    where observation_id=p_observation_id and choice <> 'skip';

  select choice, count(*) into v_top_choice, v_top_count
    from public.votes
    where observation_id=p_observation_id and choice <> 'skip'
    group by choice order by count(*) desc, choice limit 1;

  if v_valid >= 2 and v_top_count >= 2 then
    update public.observations set status='finalized', consensus=v_top_choice,
      finalized_at=now() where id=p_observation_id;
    return jsonb_build_object('status','finalized','consensus',v_top_choice);
  end if;

  if v_valid >= 3 then
    update public.observations set status='unresolved', finalized_at=now()
      where id=p_observation_id;
    return jsonb_build_object('status','unresolved','consensus',null);
  end if;

  -- If there are still pending assigned votes, let those come in first.
  if exists (select 1 from public.assignments
       where observation_id=p_observation_id and state='pending') then
    return jsonb_build_object('status','open','consensus',null);
  end if;

  -- Need another independent reviewer because of disagreement or abstention.
  select r.id into v_next_reviewer from public.reviewers r
  where not exists (
    select 1 from public.assignments a
    where a.observation_id=p_observation_id and a.reviewer_id=r.id
  )
  order by (
    select count(*) from public.assignments a2 where a2.reviewer_id=r.id
  ) asc, md5(p_observation_id || r.id) asc
  limit 1;

  if v_next_reviewer is null then
    update public.observations set status='unresolved', finalized_at=now()
      where id=p_observation_id;
    return jsonb_build_object('status','unresolved','consensus',null);
  end if;

  -- Consistent AB randomization for the next voter, independent of previous votes.
  v_left := case when substr(md5(p_observation_id || v_next_reviewer), 1, 1) in
      ('0','1','2','3','4','5','6','7') then 'a' else 'b' end;
  select count(*) into v_skip_count from public.votes
    where observation_id=p_observation_id and choice='skip';

  insert into public.assignments
    (observation_id, reviewer_id, stage, left_response, right_response)
  values (p_observation_id, v_next_reviewer,
    case when v_skip_count > 0 then 'replacement' else 'tie_break' end,
    v_left, case when v_left='a' then 'b' else 'a' end);

  return jsonb_build_object('status','open','consensus',null,
                            'assigned_reviewer',v_next_reviewer);
end;
$$;

revoke execute on function public.submit_review_vote(text,text,text) from public, anon, authenticated;
grant execute on function public.submit_review_vote(text,text,text) to service_role;
