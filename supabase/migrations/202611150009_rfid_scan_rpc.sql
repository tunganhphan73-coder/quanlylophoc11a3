-- GĐ5: atomic server-side scan RPC and current-day inferred attendance view.
-- Requires migrations 001-008. Additive only; no legacy table is altered.

create index if not exists idx_attendance_events_reader_received
  on public.attendance_events (reader_id, received_at desc);

create or replace function public.lock_rfid_attendance_slot()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform pg_advisory_xact_lock(
    hashtextextended(new.student_id::text || ':' || new.attendance_date::text || ':' || new.session, 0)
  );
  return new;
end;
$$;

revoke all on function public.lock_rfid_attendance_slot() from public, anon, authenticated;

do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.rfid_attendance_records'::regclass
      and tgname = 'rfid_attendance_slot_lock'
      and not tgisinternal
  ) then
    create trigger rfid_attendance_slot_lock
      before insert on public.rfid_attendance_records
      for each row execute function public.lock_rfid_attendance_slot();
  end if;
end;
$$;

create or replace function public.record_rfid_scan(
  p_token_hash text,
  p_tid text,
  p_epc text,
  p_scanned_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_scan_time timestamptz;
  v_is_replayed boolean := p_scanned_at is not null;
  v_reader public.rfid_readers%rowtype;
  v_card public.rfid_cards%rowtype;
  v_epc_card_id uuid;
  v_settings public.attendance_settings%rowtype;
  v_student_class uuid;
  v_feature_enabled boolean;
  v_card_found boolean := false;
  v_local timestamp;
  v_local_date date;
  v_local_time time;
  v_session text;
  v_status text;
  v_result public.attendance_event_result;
  v_tid text := nullif(trim(p_tid), '');
  v_epc text := nullif(trim(p_epc), '');
  v_event_id uuid := gen_random_uuid();
  v_attendance_id uuid;
  v_recent_scans integer;
begin
  if auth.role() is distinct from 'service_role' then
    return jsonb_build_object('result', 'unauthorized');
  end if;
  if nullif(trim(p_token_hash), '') is null or (v_tid is null and v_epc is null) then
    return jsonb_build_object('result', 'invalid_request');
  end if;

  select r.* into v_reader
  from public.rfid_readers r
  where r.token_hash = p_token_hash
  for update;
  if not found or not v_reader.is_active then
    return jsonb_build_object('result', 'unauthorized');
  end if;

  update public.rfid_readers set last_seen_at = v_now where id = v_reader.id;
  select count(*)::integer into v_recent_scans
  from public.attendance_events e
  where e.reader_id = v_reader.id and e.received_at >= v_now - interval '1 minute';
  if v_recent_scans >= 120 then
    return jsonb_build_object('result', 'rate_limited', 'retry_after', 60);
  end if;

  v_scan_time := coalesce(p_scanned_at, v_now);
  if v_is_replayed and (v_scan_time < v_now - interval '24 hours' or v_scan_time > v_now + interval '1 minute') then
    v_result := 'outside_session';
  else
    if v_tid is not null then
      select c.* into v_card from public.rfid_cards c where c.tid = v_tid limit 1;
      v_card_found := found;
    end if;
    if v_card_found and v_epc is not null then
      select c.id into v_epc_card_id from public.rfid_cards c where c.epc = v_epc limit 1;
      if found and v_epc_card_id is distinct from v_card.id then
        v_result := 'tid_mismatch';
      end if;
    end if;
    if not v_card_found and v_epc is not null then
      select c.* into v_card from public.rfid_cards c where c.epc = v_epc limit 1;
      v_card_found := found;
      if v_card_found and v_card.tid is not null and v_tid is not null and v_card.tid <> v_tid then
        v_result := 'tid_mismatch';
      end if;
    end if;

    if v_result is null and not v_card_found then
      v_result := 'unknown_card';
    elsif v_result is null and v_card.status <> 'active' then
      v_result := 'inactive_card';
    elsif v_result is null then
      select s.class_id into v_student_class from public.students s where s.id = v_card.student_id;
      select c.enable_attendance into v_feature_enabled from public.classes c where c.id = v_student_class;
      select a.* into v_settings from public.attendance_settings a where a.class_id = v_student_class;
      if not coalesce(v_feature_enabled, false) or not found then
        v_result := 'outside_session';
      else
        v_local := v_scan_time at time zone v_settings.timezone;
        v_local_date := v_local::date;
        v_local_time := v_local::time;
        if v_local_time >= v_settings.morning_start_time and v_local_time <= v_settings.morning_close_time then
          v_session := 'morning';
          v_status := case when v_local_time > v_settings.morning_late_after then 'late' else 'present' end;
        elsif v_settings.afternoon_start_time is not null
          and v_local_time >= v_settings.afternoon_start_time
          and v_local_time <= v_settings.afternoon_close_time then
          v_session := 'afternoon';
          v_status := case when v_local_time > v_settings.afternoon_late_after then 'late' else 'present' end;
        else
          v_result := 'outside_session';
        end if;

        if v_result is null then
          perform pg_advisory_xact_lock(
            hashtextextended(v_card.student_id::text || ':' || v_local_date::text || ':' || v_session, 0)
          );
          if exists (
            select 1 from public.rfid_attendance_records r
            where r.student_id = v_card.student_id
              and r.attendance_date = v_local_date and r.session = v_session
          ) then
            v_result := 'duplicate';
          else
            v_result := 'accepted';
          end if;
        end if;
      end if;
    end if;
  end if;

  insert into public.attendance_events (
    id, reader_id, tid, epc, scanned_at, received_at, card_id, student_id, result, is_replayed
  ) values (
    v_event_id, v_reader.id, v_tid, v_epc, v_scan_time, v_now,
    case when v_card.id is null then null else v_card.id end,
    case when v_card.id is null then null else v_card.student_id end,
    coalesce(v_result, 'outside_session'), v_is_replayed
  );

  if v_result = 'accepted' then
    insert into public.rfid_attendance_records (
      class_id, student_id, attendance_date, session, status, check_in_at,
      source, event_id, entered_by_name, is_locked, created_by
    ) values (
      v_student_class, v_card.student_id, v_local_date, v_session, v_status, v_scan_time,
      'rfid', v_event_id, 'Đầu đọc RFID', true, null
    ) returning id into v_attendance_id;
  end if;

  return jsonb_build_object(
    'result', coalesce(v_result, 'outside_session'),
    'event_id', v_event_id,
    'attendance_id', v_attendance_id,
    'student_id', case when v_card.id is null then null else v_card.student_id end,
    'session', v_session,
    'status', v_status,
    'is_replayed', v_is_replayed
  );
end;
$$;

revoke all on function public.record_rfid_scan(text, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.record_rfid_scan(text, text, text, timestamptz) to service_role;

create or replace view public.rfid_attendance_today
with (security_invoker = true)
as
select
  s.class_id,
  s.id as student_id,
  s.student_number,
  s.full_name,
  local_now.local_date as attendance_date,
  session_rows.session,
  case
    when r.id is not null then r.status
    when local_now.local_time > session_rows.close_time then 'absent_unexcused'
    else 'not_scanned'
  end as status,
  r.check_in_at,
  r.source,
  r.reason
from public.classes c
join public.students s on s.class_id = c.id
join public.attendance_settings a on a.class_id = c.id
cross join lateral (
  select timezone(a.timezone, now())::date as local_date,
         timezone(a.timezone, now())::time as local_time
) local_now
cross join lateral (
  select 'morning'::text as session, a.morning_close_time as close_time
  union all
  select 'afternoon'::text, a.afternoon_close_time
  where a.afternoon_close_time is not null
) session_rows
left join public.rfid_attendance_records r
  on r.class_id = c.id
 and r.student_id = s.id
 and r.attendance_date = local_now.local_date
 and r.session = session_rows.session
where c.enable_attendance = true;

grant select on public.rfid_attendance_today to authenticated;
revoke all on public.rfid_attendance_today from anon;
