-- Version 3: keyword/tag reasons. Run ONCE in Supabase SQL Editor on an EXISTING v2 database.
-- Safe for existing observations and votes: adds columns, does not truncate data.
-- Deploy updated Next.js code after this migration.
begin;
alter table public.votes add column if not exists reason_tags jsonb not null default '[]'::jsonb;
alter table public.votes add column if not exists reason_keywords text not null default '';
alter table public.votes add column if not exists reason_keywords_target text not null default 'both' check (reason_keywords_target in ('a','b','both'));
drop function if exists public.submit_review_vote(text,text,text);
create or replace function public.submit_review_vote(
  p_observation_id text,
  p_reviewer_id text,
  p_choice text,
  p_reason_tags jsonb default '[]'::jsonb,
  p_reason_keywords text default '',
  p_reason_keywords_target text default 'both'
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
  if jsonb_typeof(p_reason_tags) <> 'array' or jsonb_array_length(p_reason_tags) > 8
     or length(p_reason_keywords) > 160
     or p_reason_keywords_target not in ('a','b','both') then
    raise exception 'Invalid reason metadata';
  end if;
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

  insert into public.votes (observation_id, reviewer_id, choice, reason_tags, reason_keywords, reason_keywords_target)
    values (p_observation_id, p_reviewer_id, p_choice, p_reason_tags, p_reason_keywords, p_reason_keywords_target);
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

revoke execute on function public.submit_review_vote(text,text,text,jsonb,text,text) from public, anon, authenticated;
grant execute on function public.submit_review_vote(text,text,text,jsonb,text,text) to service_role;

commit;
