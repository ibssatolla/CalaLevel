-- CalaLevel Phase 3.3: Row Level Security and grants.
-- Rule: the browser can READ its own rows. Every write goes through a function in the functions migration.

alter table public.profiles           enable row level security;
alter table public.characters         enable row level security;
alter table public.user_preferences   enable row level security;
alter table public.workouts           enable row level security;
alter table public.quests             enable row level security;
alter table public.quest_progress     enable row level security;
alter table public.xp_transactions    enable row level security;
alter table public.achievements       enable row level security;
alter table public.cosmetics          enable row level security;
alter table public.app_state          enable row level security;
alter table public.policy_acceptances enable row level security;
alter table public.policy_versions    enable row level security;
alter table public.quest_reward_caps  enable row level security;
alter table public.unlock_catalog     enable row level security;

-- Supabase grants table rights to anon and authenticated by default. Take everything back, then give back SELECT only.
revoke all on all tables in schema public from anon, authenticated;

grant select on public.profiles, public.characters, public.user_preferences, public.workouts, public.quests,
                public.quest_progress, public.xp_transactions, public.achievements, public.cosmetics,
                public.app_state, public.policy_acceptances
  to authenticated;
-- Reference tables are readable by everyone signed in (the welcome and signup screens show the policy versions).
grant select on public.policy_versions, public.quest_reward_caps, public.unlock_catalog to anon, authenticated;

-- Own-row read policies. is_email_verified() (functions migration) is the second layer behind "Confirm email".
create policy profiles_select_own on public.profiles for select to authenticated
  using (id = (select auth.uid()) and (select public.is_email_verified()));
create policy characters_select_own on public.characters for select to authenticated
  using (user_id = (select auth.uid()) and (select public.is_email_verified()));
create policy user_preferences_select_own on public.user_preferences for select to authenticated
  using (user_id = (select auth.uid()) and (select public.is_email_verified()));
create policy workouts_select_own on public.workouts for select to authenticated
  using (user_id = (select auth.uid()) and (select public.is_email_verified()));
create policy quests_select_own on public.quests for select to authenticated
  using (user_id = (select auth.uid()) and (select public.is_email_verified()));
create policy quest_progress_select_own on public.quest_progress for select to authenticated
  using (user_id = (select auth.uid()) and (select public.is_email_verified()));
create policy xp_transactions_select_own on public.xp_transactions for select to authenticated
  using (user_id = (select auth.uid()) and (select public.is_email_verified()));
create policy achievements_select_own on public.achievements for select to authenticated
  using (user_id = (select auth.uid()) and (select public.is_email_verified()));
create policy cosmetics_select_own on public.cosmetics for select to authenticated
  using (user_id = (select auth.uid()) and (select public.is_email_verified()));
create policy app_state_select_own on public.app_state for select to authenticated
  using (user_id = (select auth.uid()) and (select public.is_email_verified()));
create policy policy_acceptances_select_own on public.policy_acceptances for select to authenticated
  using (user_id = (select auth.uid()) and (select public.is_email_verified()));

create policy policy_versions_read on public.policy_versions for select to anon, authenticated using (true);
create policy quest_reward_caps_read on public.quest_reward_caps for select to anon, authenticated using (true);
create policy unlock_catalog_read on public.unlock_catalog for select to anon, authenticated using (true);

-- No insert, update or delete policy exists for authenticated or anon, and no such table grant exists either.
-- Two layers: a write is refused by the missing privilege first, and would be refused by RLS if the privilege came back.

-- Functions: nothing is executable by default. The functions migration grants execute to authenticated one by one.
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;
