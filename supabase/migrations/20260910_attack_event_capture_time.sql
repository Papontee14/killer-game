-- Display attack news at the time the Killer captured/sent the evidence.
-- Host approval remains the point at which the attack is resolved and
-- notifications are dispatched; this only corrects the event timestamp.
begin;

create or replace function public.set_attack_event_capture_time()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  capture_time timestamptz;
  v_target_id uuid := coalesce(new.visible_to_player_id, new.excluded_player_id);
begin
  if new.type = 'attack'
     or (new.type = 'warning' and new.message = 'คุณถูกโจมตีและเสียหัวใจ 1 ดวง') then
    if v_target_id is not null then
      -- During v24 resolution the evidence is still pending when the
      -- private/public attack event is inserted. After resolution, the
      -- lethal event is inserted after the evidence is approved.
      if to_regclass('public.v24_actions') is not null then
        select e.captured_at
          into capture_time
          from public.evidence e
          left join public.v24_actions va on va.evidence_id = e.id
         where e.room_id = new.room_id
           and e.target_id = v_target_id
           and e.status in ('pending','approved')
         order by (e.status = 'pending') desc,
                  case when e.status = 'pending' then va.effective_at end asc nulls last,
                  e.decision_at desc nulls first,
                  e.created_at desc, e.id desc
         limit 1;
      else
        select e.captured_at
          into capture_time
          from public.evidence e
         where e.room_id = new.room_id
           and e.target_id = v_target_id
           and e.status in ('pending','approved')
         order by (e.status = 'pending') desc,
                  e.decision_at desc nulls first,
                  e.created_at desc, e.id desc
         limit 1;
      end if;
    else
      -- Public lethal attack events do not carry a target id. The newest
      -- evidence in this room is the action being resolved in the same
      -- locked transaction.
      if to_regclass('public.v24_actions') is not null then
        select e.captured_at
          into capture_time
          from public.evidence e
          left join public.v24_actions va on va.evidence_id = e.id
         where e.room_id = new.room_id
           and e.status in ('pending','approved')
         order by (e.status = 'pending') desc,
                  case when e.status = 'pending' then va.effective_at end asc nulls last,
                  e.decision_at desc nulls first,
                  e.created_at desc, e.id desc
         limit 1;
      else
        select e.captured_at
          into capture_time
          from public.evidence e
         where e.room_id = new.room_id
           and e.status in ('pending','approved')
         order by (e.status = 'pending') desc,
                  e.decision_at desc nulls first,
                  e.created_at desc, e.id desc
         limit 1;
      end if;
    end if;

    if capture_time is not null then
      new.created_at := capture_time;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists attack_event_capture_time on public.room_events;
create trigger attack_event_capture_time
before insert on public.room_events
for each row execute function public.set_attack_event_capture_time();

revoke all on function public.set_attack_event_capture_time() from public, anon, authenticated;
notify pgrst, 'reload schema';
commit;
