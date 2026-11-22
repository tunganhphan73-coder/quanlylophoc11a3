-- Add student teams to an existing Supabase project. Safe to run again.
begin;

alter table public.students
  add column if not exists team_number integer not null default 1;

alter table public.students
  alter column team_number set default 1;

update public.students
  set team_number = 1
  where team_number is null;

alter table public.students
  alter column team_number set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.students'::regclass
      and conname = 'students_team_number_check'
  ) then
    alter table public.students
      add constraint students_team_number_check
      check (team_number > 0) not valid;
  end if;
end;
$$;

create index if not exists idx_students_class_team_name
  on public.students (class_id, team_number, full_name);

commit;
