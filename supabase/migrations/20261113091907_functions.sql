-- CalaLevel Phase 3.3: functions and triggers.
-- All writes from the app go through the public functions below. They run as the table owner (security definer),
-- check the caller with auth.uid(), and are safe to call again with the same input.
-- Errors are short codes (for example 'email_not_verified') that the app maps to messages.

------------------------------------------------------------------------------
-- Small helpers
------------------------------------------------------------------------------

create function public.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin new.updated_at := now(); return new; end $$;

create trigger profiles_touch         before update on public.profiles         for each row execute function public.touch_updated_at();
create trigger characters_touch       before update on public.characters       for each row execute function public.touch_updated_at();
create trigger user_preferences_touch before update on public.user_preferences for each row execute function public.touch_updated_at();
create trigger app_state_touch        before update on public.app_state        for each row execute function public.touch_updated_at();
create trigger quest_progress_touch   before update on public.quest_progress   for each row execute function public.touch_updated_at();

-- Level L starts at 500 * (L - 1) * L total XP. Same curve as js/progression.js and js/config.js.
create function public.xp_floor_for_level(l integer) returns integer
language sql immutable set search_path = '' as $$ select 500 * (l - 1) * l $$;

create function public.level_for_xp(xp bigint) returns integer
language plpgsql immutable set search_path = '' as $$
declare l integer := 1;
begin
  while public.xp_floor_for_level(l + 1) <= xp loop l := l + 1; end loop;
  return l;
end $$;

-- True when the signed-in user has confirmed the email address. Used by every policy and function.
create function public.is_email_verified() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from auth.users u
    where u.id = (select auth.uid()) and u.email_confirmed_at is not null
  )
$$;

-- Returns the caller id, or raises. Internal.
create function public._require_user() returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare uid uuid := (select auth.uid());
begin
  if uid is null then raise exception 'not_authenticated' using errcode = 'P0001'; end if;
  if not public.is_email_verified() then raise exception 'email_not_verified' using errcode = 'P0001'; end if;
  return uid;
end $$;

create function public._step_rank(s text) returns integer
language sql immutable set search_path = '' as $$
  select case s when 'character' then 1 when 'goals' then 2 when 'preferences' then 3 when 'summary' then 4 when 'done' then 5 else 0 end
$$;

-- Moves the onboarding step forward only. Never backwards, never to 'done' (complete_onboarding does that).
create function public._advance_step(uid uuid, target text) returns void
language sql security definer set search_path = '' as $$
  update public.profiles set onboarding_step = target
  where id = uid and not onboarding_completed and public._step_rank(onboarding_step) < public._step_rank(target)
$$;

create function public._policies_accepted(uid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select not exists (
    select 1 from public.policy_versions v
    where v.is_current and not exists (
      select 1 from public.policy_acceptances a
      where a.user_id = uid and a.policy_type = v.policy_type and a.version = v.version
    )
  )
$$;

------------------------------------------------------------------------------
-- Account creation, XP totals
------------------------------------------------------------------------------

-- New auth user -> profile row + recorded policy acceptance. The time is the database time, not the client's.
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  t text := new.raw_user_meta_data ->> 'accepted_terms';
  p text := new.raw_user_meta_data ->> 'accepted_privacy';
begin
  insert into public.profiles (id, email) values (new.id, new.email) on conflict (id) do nothing;
  if t is not null and exists (select 1 from public.policy_versions where policy_type = 'terms' and version = t) then
    insert into public.policy_acceptances (user_id, policy_type, version) values (new.id, 'terms', t) on conflict do nothing;
  end if;
  if p is not null and exists (select 1 from public.policy_versions where policy_type = 'privacy' and version = p) then
    insert into public.policy_acceptances (user_id, policy_type, version) values (new.id, 'privacy', p) on conflict do nothing;
  end if;
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

create function public.sync_profile_email() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.profiles set email = new.email where id = new.id;
  return new;
end $$;

create trigger on_auth_user_email_changed after update of email on auth.users
  for each row when (old.email is distinct from new.email) execute function public.sync_profile_email();

-- Recomputes total_xp, level and current_xp of a character from the XP ledger.
create function public._recalc_character(uid uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare total integer; lvl integer;
begin
  select coalesce(sum(xp_amount), 0) into total from public.xp_transactions where user_id = uid;
  lvl := public.level_for_xp(total);
  perform set_config('cala.xp_write', 'on', true);  -- lets the guard trigger below allow this one write
  update public.characters
     set total_xp = total, level = lvl, current_xp = total - public.xp_floor_for_level(lvl)
   where user_id = uid;
  perform set_config('cala.xp_write', '', true);
end $$;

create function public._xp_after_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
begin perform public._recalc_character(new.user_id); return new; end $$;

create trigger xp_transactions_recalc after insert on public.xp_transactions
  for each row execute function public._xp_after_insert();

-- Defence in depth: XP columns may only change inside _recalc_character. Even the table owner gets 'xp_is_read_only' otherwise.
create function public._guard_character_xp() returns trigger
language plpgsql set search_path = '' as $$
begin
  if coalesce(current_setting('cala.xp_write', true), '') <> 'on' and (
       new.level is distinct from old.level or new.current_xp is distinct from old.current_xp or new.total_xp is distinct from old.total_xp) then
    raise exception 'xp_is_read_only' using errcode = 'P0001';
  end if;
  return new;
end $$;

create trigger characters_guard_xp before update on public.characters
  for each row execute function public._guard_character_xp();

-- A ledger row can never be changed or removed (except by deleting the whole account through the cascade).
create function public._ledger_is_append_only() returns trigger
language plpgsql set search_path = '' as $$
begin raise exception 'ledger_is_append_only' using errcode = 'P0001'; end $$;

create trigger xp_transactions_no_update before update on public.xp_transactions
  for each row execute function public._ledger_is_append_only();

------------------------------------------------------------------------------
-- Validation helpers
------------------------------------------------------------------------------

-- Checks avatar and cosmetic options. An item must be a default item or one the user has unlocked.
create function public._check_cosmetics(uid uuid, p_avatar text, p_options jsonb) returns void
language plpgsql stable security definer set search_path = '' as $$
declare k text; v text; cat text;
begin
  if p_options is null or jsonb_typeof(p_options) <> 'object' then
    raise exception 'invalid_cosmetics' using errcode = 'P0001';
  end if;
  for k, v in select key, value #>> '{}' from jsonb_each(p_options) loop
    if k not in ('frame', 'background', 'title', 'badge') then raise exception 'invalid_cosmetics' using errcode = 'P0001'; end if;
    if not exists (
      select 1 from public.unlock_catalog c
      where c.kind = 'cosmetic' and c.id = v and c.category = k
        and (c.is_default or exists (select 1 from public.cosmetics o where o.user_id = uid and o.cosmetic_id = c.id))
    ) then raise exception 'invalid_cosmetics' using errcode = 'P0001'; end if;
  end loop;
  if not exists (
    select 1 from public.unlock_catalog c
    where c.kind = 'cosmetic' and c.id = p_avatar and c.category = 'avatar'
      and (c.is_default or exists (select 1 from public.cosmetics o where o.user_id = uid and o.cosmetic_id = c.id))
  ) then raise exception 'invalid_cosmetics' using errcode = 'P0001'; end if;
end $$;

------------------------------------------------------------------------------
-- Reading
------------------------------------------------------------------------------

-- Everything the app needs after login, in one consistent snapshot.
create function public.get_progress() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare uid uuid := public._require_user();
begin
  return jsonb_build_object(
    'profile', (select jsonb_build_object('username', p.username, 'email', p.email, 'onboarding_completed', p.onboarding_completed,
                                           'onboarding_step', p.onboarding_step, 'created_at', p.created_at)
                  from public.profiles p where p.id = uid),
    'character', (select jsonb_build_object('id', c.id, 'name', c.character_name, 'avatar_id', c.avatar_id, 'cosmetic_options', c.cosmetic_options,
                                             'level', c.level, 'current_xp', c.current_xp, 'total_xp', c.total_xp, 'created_at', c.created_at)
                    from public.characters c where c.user_id = uid),
    'preferences', (select jsonb_build_object('primary_goal', u.primary_goal, 'secondary_goals', u.secondary_goals,
                                               'training_experience', u.training_experience, 'training_environment', u.training_environment,
                                               'available_equipment', u.available_equipment, 'weekly_training_frequency', u.weekly_training_frequency,
                                               'preferred_workout_duration', u.preferred_workout_duration)
                      from public.user_preferences u where u.user_id = uid),
    'total_xp', (select coalesce(sum(xp_amount), 0) from public.xp_transactions where user_id = uid),
    'legacy_imported', exists (select 1 from public.xp_transactions where user_id = uid and source_type = 'legacy_import'),
    'workouts', coalesce((select jsonb_agg(jsonb_build_object('client_id', w.client_id, 'type', w.workout_type, 'title', w.title,
                                                                'duration', w.duration, 'exercises', w.exercises, 'xp', w.xp,
                                                                'imported', w.imported, 'details', w.details, 'completed_at', w.completed_at)
                                           order by w.completed_at)
                            from public.workouts w where w.user_id = uid), '[]'::jsonb),
    'quests', coalesce((select jsonb_agg(jsonb_build_object('client_id', q.client_id, 'date', q.quest_date, 'slot', q.slot, 'category', q.quest_type,
                                                              'template_id', q.template_id, 'difficulty', q.difficulty, 'title', q.title,
                                                              'description', q.description, 'metric', q.metric, 'target', q.target, 'status', q.status,
                                                              'reward_xp', q.reward_xp, 'extra', q.extra, 'completed_at', q.completed_at,
                                                              'progress', coalesce(g.progress, 0), 'reward_status', coalesce(g.reward_status, 'none'))
                                         order by q.quest_date, q.created_at)
                          from public.quests q left join public.quest_progress g on g.quest_id = q.id where q.user_id = uid), '[]'::jsonb),
    'quest_rewards', coalesce((select jsonb_agg(jsonb_build_object('source_id', t.source_id, 'xp', t.xp_amount, 'at', t.created_at) order by t.created_at)
                                 from public.xp_transactions t where t.user_id = uid and t.source_type = 'quest'), '[]'::jsonb),
    'achievements', coalesce((select jsonb_agg(a.achievement_id) from public.achievements a where a.user_id = uid), '[]'::jsonb),
    'cosmetics', coalesce((select jsonb_agg(c.cosmetic_id) from public.cosmetics c where c.user_id = uid), '[]'::jsonb),
    'app_state', coalesce((select s.data from public.app_state s where s.user_id = uid), '{}'::jsonb),
    'policies_accepted', public._policies_accepted(uid)
  );
end $$;

------------------------------------------------------------------------------
-- Onboarding
------------------------------------------------------------------------------

create function public.accept_policies(p_terms text, p_privacy text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare uid uuid := public._require_user();
begin
  if not exists (select 1 from public.policy_versions where policy_type = 'terms' and version = p_terms)
     or not exists (select 1 from public.policy_versions where policy_type = 'privacy' and version = p_privacy) then
    raise exception 'unknown_policy_version' using errcode = 'P0001';
  end if;
  insert into public.policy_acceptances (user_id, policy_type, version) values (uid, 'terms', p_terms) on conflict do nothing;
  insert into public.policy_acceptances (user_id, policy_type, version) values (uid, 'privacy', p_privacy) on conflict do nothing;
  return jsonb_build_object('accepted', public._policies_accepted(uid));
end $$;

-- Creates the character, or updates its name and looks. Level and XP can not be passed in. Safe to call again.
create function public.save_character(p_name text, p_avatar text, p_options jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare uid uuid := public._require_user(); n text := btrim(coalesce(p_name, '')); ch public.characters;
begin
  if char_length(n) < 1 or char_length(n) > 20 or n ~ '[[:cntrl:]<>]' then raise exception 'invalid_name' using errcode = 'P0001'; end if;
  perform public._check_cosmetics(uid, p_avatar, coalesce(p_options, '{}'::jsonb));
  insert into public.profiles (id) values (uid) on conflict (id) do nothing;
  insert into public.characters (user_id, character_name, avatar_id, cosmetic_options)
    values (uid, n, p_avatar, coalesce(p_options, '{}'::jsonb))
  on conflict (user_id) do update
    set character_name = excluded.character_name, avatar_id = excluded.avatar_id, cosmetic_options = excluded.cosmetic_options
  returning * into ch;
  perform public._recalc_character(uid);  -- a new character picks up any XP already in the ledger
  perform public._advance_step(uid, 'goals');
  return jsonb_build_object('id', ch.id, 'name', ch.character_name, 'avatar_id', ch.avatar_id, 'cosmetic_options', ch.cosmetic_options,
                            'level', (select level from public.characters where user_id = uid),
                            'total_xp', (select total_xp from public.characters where user_id = uid));
end $$;

create function public.save_goals(p_primary text, p_secondary text[] default '{}') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare uid uuid := public._require_user(); sec text[];
begin
  if not exists (select 1 from public.characters where user_id = uid) then raise exception 'character_required' using errcode = 'P0001'; end if;
  if p_primary is null or not (p_primary = any (array['strength', 'skills', 'endurance', 'mobility', 'fat-loss', 'general'])) then
    raise exception 'invalid_goal' using errcode = 'P0001';
  end if;
  select coalesce(array_agg(distinct g), '{}') into sec from unnest(coalesce(p_secondary, '{}')) g where g <> p_primary;
  if not (sec <@ array['strength', 'skills', 'endurance', 'mobility', 'fat-loss', 'general']) or cardinality(sec) > 3 then
    raise exception 'invalid_goal' using errcode = 'P0001';
  end if;
  insert into public.user_preferences (user_id, primary_goal, secondary_goals) values (uid, p_primary, sec)
  on conflict (user_id) do update set primary_goal = excluded.primary_goal, secondary_goals = excluded.secondary_goals;
  perform public._advance_step(uid, 'preferences');
  return jsonb_build_object('primary_goal', p_primary, 'secondary_goals', to_jsonb(sec));
end $$;

create function public.save_preferences(p_experience text, p_environment text, p_equipment text[], p_frequency integer, p_duration text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare uid uuid := public._require_user(); eq text[];
begin
  if not exists (select 1 from public.user_preferences where user_id = uid and primary_goal is not null) then
    raise exception 'goals_required' using errcode = 'P0001';
  end if;
  if p_experience is null or p_experience <> all (array['beginner', 'intermediate', 'advanced']) then raise exception 'invalid_preferences' using errcode = 'P0001'; end if;
  if p_environment is null or p_environment <> all (array['home', 'outdoor', 'gym', 'mixed']) then raise exception 'invalid_preferences' using errcode = 'P0001'; end if;
  if p_frequency is null or p_frequency not between 2 and 6 then raise exception 'invalid_preferences' using errcode = 'P0001'; end if;
  if p_duration is null or p_duration <> all (array['15-20', '20-30', '30-45', '45-60', '60+']) then raise exception 'invalid_preferences' using errcode = 'P0001'; end if;
  select coalesce(array_agg(distinct e), '{}') into eq from unnest(coalesce(p_equipment, '{}')) e;
  if cardinality(eq) = 0 or not (eq <@ array['none', 'pullup-bar', 'bands', 'gym', 'parallel-bars', 'rings', 'other'])
     or ('none' = any (eq) and cardinality(eq) > 1) then
    raise exception 'invalid_preferences' using errcode = 'P0001';
  end if;
  update public.user_preferences
     set training_experience = p_experience, training_environment = p_environment, available_equipment = eq,
         weekly_training_frequency = p_frequency, preferred_workout_duration = p_duration
   where user_id = uid;
  perform public._advance_step(uid, 'summary');
  return jsonb_build_object('saved', true);
end $$;

-- Finishes onboarding. Needs a character, answered preferences (unless local progress was imported) and accepted policies.
create function public.complete_onboarding() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare uid uuid := public._require_user(); done boolean; ready boolean;
begin
  select onboarding_completed into done from public.profiles where id = uid;
  if done then return jsonb_build_object('completed', true, 'already', true); end if;
  if not exists (select 1 from public.characters where user_id = uid) then raise exception 'character_required' using errcode = 'P0001'; end if;
  select exists (select 1 from public.user_preferences p where p.user_id = uid and p.primary_goal is not null and p.training_experience is not null
                   and p.training_environment is not null and p.weekly_training_frequency is not null and p.preferred_workout_duration is not null)
    into ready;
  if not ready then raise exception 'preferences_required' using errcode = 'P0001'; end if;
  if not public._policies_accepted(uid) then raise exception 'policies_not_accepted' using errcode = 'P0001'; end if;
  update public.profiles set onboarding_completed = true, onboarding_step = 'done' where id = uid;
  return jsonb_build_object('completed', true, 'already', false);
end $$;

create function public.set_username(p_username text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare uid uuid := public._require_user();
begin
  if p_username is not null and p_username !~ '^[A-Za-z0-9_]{3,24}$' then raise exception 'invalid_username' using errcode = 'P0001'; end if;
  begin
    update public.profiles set username = p_username where id = uid;
  exception when unique_violation then
    raise exception 'username_taken' using errcode = 'P0001';
  end;
  return jsonb_build_object('username', p_username);
end $$;

------------------------------------------------------------------------------
-- Progression
------------------------------------------------------------------------------

-- Stores one workout and pays its XP once. The XP is computed here from the sets. The browser's XP number is not used.
-- Same rule as js/progression.js: 10 per set + reps (timed holds: 1 per 5 s), +25 for a complete session.
create function public.record_workout(
  p_client_id text, p_type text, p_title text, p_exercises jsonb, p_duration integer,
  p_completed_at timestamptz default now(), p_complete boolean default false, p_details jsonb default '{}'::jsonb
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := public._require_user();
  ex jsonb; r jsonb; n integer := 0; sets integer := 0; xp integer := 0; effort numeric; maxrep numeric;
  at_ timestamptz := coalesce(p_completed_at, now());
  wid uuid; prev public.workouts; today_xp integer;
begin
  if not exists (select 1 from public.profiles where id = uid and onboarding_completed) then
    raise exception 'onboarding_incomplete' using errcode = 'P0001';
  end if;
  select * into prev from public.workouts where user_id = uid and client_id = p_client_id;
  if found then return jsonb_build_object('created', false, 'xp', prev.xp, 'workout_id', prev.id); end if;

  if p_exercises is null or jsonb_typeof(p_exercises) <> 'array' or jsonb_array_length(p_exercises) not between 1 and 30 then
    raise exception 'invalid_workout' using errcode = 'P0001';
  end if;
  if p_duration is null or p_duration not between 0 and 21600 then raise exception 'invalid_workout' using errcode = 'P0001'; end if;
  if at_ > now() + interval '10 minutes' or at_ < timestamptz '2020-01-01' then raise exception 'invalid_workout' using errcode = 'P0001'; end if;

  for ex in select value from jsonb_array_elements(p_exercises) loop
    if jsonb_typeof(ex) <> 'object' or jsonb_typeof(ex -> 'reps') <> 'array' or (ex ->> 'unit') not in ('reps', 'sec') then
      raise exception 'invalid_workout' using errcode = 'P0001';
    end if;
    maxrep := case when ex ->> 'unit' = 'sec' then 3600 else 1000 end;
    for r in select value from jsonb_array_elements(ex -> 'reps') loop
      if jsonb_typeof(r) <> 'number' or (r #>> '{}')::numeric < 0 or (r #>> '{}')::numeric > maxrep then
        raise exception 'invalid_workout' using errcode = 'P0001';
      end if;
      effort := case when ex ->> 'unit' = 'sec' then round((r #>> '{}')::numeric / 5) else round((r #>> '{}')::numeric) end;
      xp := xp + 10 + greatest(0, effort)::integer;
      sets := sets + 1;
    end loop;
  end loop;
  if sets = 0 or sets > 200 then raise exception 'invalid_workout' using errcode = 'P0001'; end if;
  if coalesce(p_complete, false) then xp := xp + 25; end if;

  -- One day can not pay more than 3000 workout XP (UTC day of the workout).
  select coalesce(sum(w.xp), 0) into today_xp from public.workouts w
   where w.user_id = uid and not w.imported and (w.completed_at at time zone 'UTC')::date = (at_ at time zone 'UTC')::date;
  if today_xp + xp > 3000 then raise exception 'daily_xp_cap' using errcode = 'P0001'; end if;

  insert into public.workouts (user_id, client_id, workout_type, title, duration, exercises, xp, details, completed_at)
    values (uid, p_client_id, p_type, left(p_title, 120), p_duration, p_exercises, xp, coalesce(p_details, '{}'::jsonb), at_)
  on conflict (user_id, client_id) do nothing
  returning id into wid;
  if wid is null then  -- another request stored it between the check and the insert
    select * into prev from public.workouts where user_id = uid and client_id = p_client_id;
    return jsonb_build_object('created', false, 'xp', prev.xp, 'workout_id', prev.id);
  end if;
  insert into public.xp_transactions (user_id, source_type, source_id, xp_amount) values (uid, 'workout', p_client_id, xp)
    on conflict (user_id, source_type, source_id) do nothing;
  return jsonb_build_object('created', true, 'xp', xp, 'workout_id', wid);
end $$;

-- Stores quests and pays the reward of each completed quest once.
-- Quest definitions never change after the first save. Status only moves from active to completed or expired.
-- A quest counts as completed only if a workout exists on its day (plus or minus one day for time zones).
create function public.sync_quests(p_quests jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := public._require_user();
  q jsonb; result jsonb := '[]'::jsonb; cid text; qd date; slot_ text; cap integer; reward integer; st text; prog numeric;
  tgt numeric; qid uuid; existing public.quests; granted integer; rstatus text; evidence boolean;
  done_at timestamptz;
begin
  if not exists (select 1 from public.profiles where id = uid and onboarding_completed) then
    raise exception 'onboarding_incomplete' using errcode = 'P0001';
  end if;
  if p_quests is null or jsonb_typeof(p_quests) <> 'array' or jsonb_array_length(p_quests) > 20 then
    raise exception 'invalid_quests' using errcode = 'P0001';
  end if;
  for q in select value from jsonb_array_elements(p_quests) loop
    cid := q ->> 'id';
    begin
      qd := (q ->> 'date')::date;
    exception when others then raise exception 'invalid_quests' using errcode = 'P0001';
    end;
    slot_ := q ->> 'slot';
    select max_xp into cap from public.quest_reward_caps where slot = slot_;
    if cid is null or char_length(cid) not between 1 and 80 or cap is null or qd < current_date - 60 or qd > current_date + 1
       or jsonb_typeof(q -> 'metric') <> 'object' or (q ->> 'status') not in ('active', 'completed', 'expired') then
      raise exception 'invalid_quests' using errcode = 'P0001';
    end if;
    reward := least(greatest(coalesce((q ->> 'rewardXp')::integer, 0), 0), cap);
    tgt := (q ->> 'target')::numeric;
    prog := least(greatest(coalesce((q ->> 'progress')::numeric, 0), 0), tgt);
    st := q ->> 'status';
    done_at := case when (q ->> 'completedAt') ~ '^[0-9]{10,14}$' then to_timestamp(((q ->> 'completedAt')::numeric) / 1000) else null end;

    select * into existing from public.quests where user_id = uid and client_id = cid;
    if not found then
      -- At most five quests per day.
      if (select count(*) from public.quests where user_id = uid and quest_date = qd) >= 5 then
        result := result || jsonb_build_object('id', cid, 'skipped', 'too_many_quests');
        continue;
      end if;
      insert into public.quests (user_id, client_id, quest_date, slot, quest_type, template_id, difficulty, title, description, metric, target, status, reward_xp, extra)
        values (uid, cid, qd, slot_, left(coalesce(q ->> 'category', ''), 40), left(coalesce(q ->> 'templateId', ''), 80),
                greatest(1, least(3, coalesce((q ->> 'difficulty')::integer, 1))), left(coalesce(q ->> 'title', ''), 120),
                left(coalesce(q ->> 'description', ''), 240), q -> 'metric', tgt, 'active', reward,
                case when jsonb_typeof(q -> 'extra') = 'object' then q -> 'extra' else '{}'::jsonb end)
        on conflict (user_id, client_id) do nothing;
      select * into existing from public.quests where user_id = uid and client_id = cid;
    end if;

    if existing.status = 'active' and st <> 'active' then
      evidence := st = 'expired' or exists (
        select 1 from public.workouts w where w.user_id = uid
          and (w.completed_at at time zone 'UTC')::date between qd - 1 and qd + 1);
      if evidence then
        update public.quests set status = st, completed_at = case when st = 'completed' then coalesce(done_at, now()) else null end
         where id = existing.id returning * into existing;
      end if;
    end if;

    insert into public.quest_progress (user_id, quest_id, progress) values (uid, existing.id, prog)
      on conflict (quest_id) do update set progress = greatest(public.quest_progress.progress, excluded.progress);

    granted := 0;
    select reward_status into rstatus from public.quest_progress where quest_id = existing.id;
    if existing.status = 'completed' and rstatus <> 'granted' then
      if existing.reward_xp > 0 then
        insert into public.xp_transactions (user_id, source_type, source_id, xp_amount)
          values (uid, 'quest', cid, existing.reward_xp) on conflict (user_id, source_type, source_id) do nothing;
        granted := existing.reward_xp;
      end if;
      update public.quest_progress set reward_status = 'granted' where quest_id = existing.id;
      rstatus := 'granted';
    end if;
    result := result || jsonb_build_object('id', cid, 'status', existing.status, 'reward_status', rstatus, 'xp_granted', granted);
  end loop;
  return result;
end $$;

-- Records unlocked achievements and cosmetics. Unknown ids are ignored.
-- The server can not check the unlock rules (they run in the browser), so this only stores what the app reports.
create function public.sync_unlocks(p_achievements text[] default '{}', p_cosmetics text[] default '{}') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare uid uuid := public._require_user(); a integer; c integer;
begin
  if cardinality(coalesce(p_achievements, '{}')) > 50 or cardinality(coalesce(p_cosmetics, '{}')) > 100 then
    raise exception 'invalid_unlocks' using errcode = 'P0001';
  end if;
  insert into public.achievements (user_id, achievement_id)
    select uid, k.id from public.unlock_catalog k where k.kind = 'achievement' and k.id = any (coalesce(p_achievements, '{}'))
  on conflict (user_id, achievement_id) do nothing;
  get diagnostics a = row_count;
  insert into public.cosmetics (user_id, cosmetic_id)
    select uid, k.id from public.unlock_catalog k where k.kind = 'cosmetic' and not k.is_default and k.id = any (coalesce(p_cosmetics, '{}'))
  on conflict (user_id, cosmetic_id) do nothing;
  get diagnostics c = row_count;
  return jsonb_build_object('achievements_added', a, 'cosmetics_added', c);
end $$;

-- Keeps the few non-relational settings (weekly schedule, skill status, spent XP). Only known keys are kept.
create function public.save_app_state(p_data jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare uid uuid := public._require_user(); clean jsonb;
begin
  if p_data is null or jsonb_typeof(p_data) <> 'object' then raise exception 'invalid_state' using errcode = 'P0001'; end if;
  select coalesce(jsonb_object_agg(k, v), '{}'::jsonb) into clean from jsonb_each(p_data) as t(k, v)
   where k in ('weeklySchedule', 'skills', 'spentXp', 'baseline', 'achievementsSeen', 'activity');
  insert into public.app_state (user_id, data) values (uid, clean)
    on conflict (user_id) do update set data = excluded.data;
  return jsonb_build_object('saved', true);
end $$;

------------------------------------------------------------------------------
-- Import of progress made before accounts existed (localStorage)
------------------------------------------------------------------------------

-- One time per account, only into an account with no progress. Local data is never changed by this.
-- The browser claims the total XP of the old data. It is stored as ONE transaction, 'legacy_import', so it can be audited.
create function public.import_local_progress(p_data jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := public._require_user(); ch jsonb; w jsonb; q jsonb; total bigint; wsum bigint := 0;
  eq text[] := '{}'; goal text; slot_ text; cap integer; qid uuid; cnt integer;
begin
  if exists (select 1 from public.xp_transactions where user_id = uid and source_type = 'legacy_import') then
    return jsonb_build_object('imported', false, 'reason', 'already_imported');
  end if;
  if exists (select 1 from public.workouts where user_id = uid) or exists (select 1 from public.xp_transactions where user_id = uid) then
    raise exception 'account_not_empty' using errcode = 'P0001';
  end if;
  if not public._policies_accepted(uid) then raise exception 'policies_not_accepted' using errcode = 'P0001'; end if;
  if p_data is null or jsonb_typeof(p_data) <> 'object' then raise exception 'invalid_import' using errcode = 'P0001'; end if;

  total := coalesce((p_data ->> 'total_xp')::bigint, 0);
  if total < 0 or total > 10000000 then raise exception 'invalid_import' using errcode = 'P0001'; end if;
  if jsonb_typeof(coalesce(p_data -> 'workouts', '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_data -> 'workouts', '[]'::jsonb)) > 2000
     or jsonb_typeof(coalesce(p_data -> 'quests', '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_data -> 'quests', '[]'::jsonb)) > 2000 then
    raise exception 'invalid_import' using errcode = 'P0001';
  end if;

  -- Unlocks first, so the imported cosmetic choices are allowed.
  perform public.sync_unlocks_internal(uid, coalesce(array(select jsonb_array_elements_text(coalesce(p_data -> 'achievements', '[]'::jsonb))), '{}'),
                                            coalesce(array(select jsonb_array_elements_text(coalesce(p_data -> 'cosmetics', '[]'::jsonb))), '{}'));

  -- Character (imported as it is: name and looks). Level and XP come from the ledger below.
  ch := coalesce(p_data -> 'character', '{}'::jsonb);
  perform public.save_character(coalesce(ch ->> 'name', 'Athlete'), coalesce(ch ->> 'avatar', 'avatar-user'),
                                coalesce(ch -> 'options', '{}'::jsonb) - 'avatar');

  -- Preferences that exist locally map onto the new ones. The rest stays empty and can be filled in from the profile.
  if (ch -> 'equipment') ? 'bar' then eq := array_append(eq, 'pullup-bar'); end if;
  if (ch -> 'equipment') ? 'parallel' then eq := array_append(eq, 'parallel-bars'); end if;
  goal := case ch ->> 'focus' when 'strength' then 'strength' when 'skill' then 'skills' else 'general' end;
  insert into public.user_preferences (user_id, primary_goal, available_equipment) values (uid, goal, eq)
    on conflict (user_id) do nothing;

  for w in select value from jsonb_array_elements(coalesce(p_data -> 'workouts', '[]'::jsonb)) loop
    if jsonb_typeof(w) <> 'object' or char_length(coalesce(w ->> 'id', '')) not between 1 and 80
       or coalesce((w ->> 'xp')::integer, 0) not between 0 and 5000
       or jsonb_typeof(w -> 'exercises') <> 'array' then
      raise exception 'invalid_import' using errcode = 'P0001';
    end if;
    wsum := wsum + coalesce((w ->> 'xp')::integer, 0);
    insert into public.workouts (user_id, client_id, workout_type, title, duration, exercises, xp, imported, details, completed_at)
      values (uid, w ->> 'id', case when coalesce(w ->> 'type', '') ~ '^[a-z][a-z-]{0,19}$' then w ->> 'type' else 'full' end,
              left(w ->> 'title', 120), least(greatest(coalesce((w ->> 'durationSec')::integer, 0), 0), 21600), w -> 'exercises',
              coalesce((w ->> 'xp')::integer, 0), true,
              case when jsonb_typeof(w -> 'details') = 'object' then w -> 'details' else '{}'::jsonb end,
              coalesce((w ->> 'date')::timestamptz, now()))
    on conflict (user_id, client_id) do nothing;
  end loop;
  if wsum > total then raise exception 'invalid_import' using errcode = 'P0001'; end if;

  for q in select value from jsonb_array_elements(coalesce(p_data -> 'quests', '[]'::jsonb)) loop
    slot_ := q ->> 'slot';
    select max_xp into cap from public.quest_reward_caps where slot = slot_;
    if cap is null or char_length(coalesce(q ->> 'id', '')) not between 1 and 80 or jsonb_typeof(q -> 'metric') <> 'object'
       or (q ->> 'status') not in ('active', 'completed', 'expired') or coalesce((q ->> 'target')::numeric, 0) <= 0 then
      continue;  -- a malformed old quest is skipped, it does not stop the import
    end if;
    begin
    insert into public.quests (user_id, client_id, quest_date, slot, quest_type, template_id, difficulty, title, description, metric, target, status, reward_xp, extra, imported, completed_at)
      values (uid, q ->> 'id', (q ->> 'date')::date, slot_, left(coalesce(q ->> 'category', ''), 40), left(coalesce(q ->> 'templateId', ''), 80),
              greatest(1, least(3, coalesce((q ->> 'difficulty')::integer, 1))), left(coalesce(q ->> 'title', ''), 120),
              left(coalesce(q ->> 'description', ''), 240), q -> 'metric', (q ->> 'target')::numeric, q ->> 'status',
              least(greatest(coalesce((q ->> 'rewardXp')::integer, 0), 0), cap),
              case when jsonb_typeof(q -> 'extra') = 'object' then q -> 'extra' else '{}'::jsonb end, true,
              case when (q ->> 'completedAt') ~ '^[0-9]{10,14}$' then to_timestamp(((q ->> 'completedAt')::numeric) / 1000) else null end)
    on conflict (user_id, client_id) do nothing
    returning id into qid;
    if qid is not null then
      insert into public.quest_progress (user_id, quest_id, progress, reward_status)
        values (uid, qid, least(greatest(coalesce((q ->> 'progress')::numeric, 0), 0), (q ->> 'target')::numeric),
                case when q ->> 'rewardStatus' = 'granted' then 'granted' when q ->> 'status' = 'completed' then 'granted' else 'none' end)
        on conflict (quest_id) do nothing;
    end if;
    exception when others then
      null;  -- one bad old quest never stops the import
    end;
    qid := null;
  end loop;

  if total > 0 then
    insert into public.xp_transactions (user_id, source_type, source_id, xp_amount) values (uid, 'legacy_import', 'legacy', total);
  end if;
  if jsonb_typeof(p_data -> 'app_state') = 'object' then
    perform public.save_app_state(p_data -> 'app_state');
  end if;
  update public.profiles set onboarding_completed = true, onboarding_step = 'done' where id = uid;
  select count(*) into cnt from public.workouts where user_id = uid;
  return jsonb_build_object('imported', true, 'workouts', cnt, 'total_xp', total);
end $$;

-- Internal version of sync_unlocks for use inside other functions.
create function public.sync_unlocks_internal(uid uuid, p_achievements text[], p_cosmetics text[]) returns void
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.achievements (user_id, achievement_id)
    select uid, k.id from public.unlock_catalog k where k.kind = 'achievement' and k.id = any (p_achievements)
  on conflict (user_id, achievement_id) do nothing;
  insert into public.cosmetics (user_id, cosmetic_id)
    select uid, k.id from public.unlock_catalog k where k.kind = 'cosmetic' and not k.is_default and k.id = any (p_cosmetics)
  on conflict (user_id, cosmetic_id) do nothing;
end $$;

------------------------------------------------------------------------------
-- Account deletion
------------------------------------------------------------------------------

-- Deletes the signed-in user. Every user table cascades from auth.users, so all rows go with it.
-- No Storage objects exist (no uploads). If uploads are added later, delete them here first.
create function public.delete_my_account() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare uid uuid := (select auth.uid());
begin
  if uid is null then raise exception 'not_authenticated' using errcode = 'P0001'; end if;
  delete from auth.users where id = uid;
  return jsonb_build_object('deleted', true);
end $$;

------------------------------------------------------------------------------
-- Execute rights: only these functions can be called from the browser, and only when signed in.
------------------------------------------------------------------------------

do $$
declare f text;
begin
  for f in select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.prokind = 'f' loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
end $$;

grant execute on function
  public.is_email_verified(),
  public.get_progress(),
  public.accept_policies(text, text),
  public.save_character(text, text, jsonb),
  public.save_goals(text, text[]),
  public.save_preferences(text, text, text[], integer, text),
  public.complete_onboarding(),
  public.set_username(text),
  public.record_workout(text, text, text, jsonb, integer, timestamptz, boolean, jsonb),
  public.sync_quests(jsonb),
  public.sync_unlocks(text[], text[]),
  public.save_app_state(jsonb),
  public.import_local_progress(jsonb),
  public.delete_my_account()
to authenticated;
