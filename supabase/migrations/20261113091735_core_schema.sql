-- CalaLevel Phase 3.3: core schema.
-- Run order: core_schema, then functions, then security (the file names sort in that order).
-- Every user table references auth.users with ON DELETE CASCADE, so deleting the auth user deletes all data.

------------------------------------------------------------------------------
-- Reference data (not user data)
------------------------------------------------------------------------------

create table public.policy_versions (
  policy_type  text        not null check (policy_type in ('terms', 'privacy')),
  version      text        not null,
  is_current   boolean     not null default false,
  published_at timestamptz not null default now(),
  primary key (policy_type, version)
);
-- At most one current version per policy type.
create unique index policy_versions_one_current on public.policy_versions (policy_type) where is_current;
insert into public.policy_versions (policy_type, version, is_current) values
  ('terms', '2026-11-13', true),
  ('privacy', '2026-11-13', true);

-- Largest reward a quest slot may pay. The client config pays exactly these today.
create table public.quest_reward_caps (
  slot   text primary key check (slot in ('main', 'side', 'optional')),
  max_xp integer not null check (max_xp between 0 and 1000)
);
insert into public.quest_reward_caps values ('main', 100), ('side', 50), ('optional', 40);

-- Everything a user can unlock. is_default items are available from the start.
create table public.unlock_catalog (
  kind       text    not null check (kind in ('achievement', 'cosmetic')),
  id         text    not null,
  category   text,
  is_default boolean not null default false,
  primary key (kind, id)
);
insert into public.unlock_catalog (kind, id, category, is_default) values
  ('achievement', 'first-steps', null, false),
  ('achievement', 'week-warrior', null, false),
  ('achievement', 'rep-master', null, false),
  ('achievement', 'park-explorer', null, false),
  ('achievement', 'battle-ready', null, false),
  ('achievement', 'muscle-up-king', null, false),
  ('cosmetic', 'avatar-user', 'avatar', true),
  ('cosmetic', 'avatar-flame', 'avatar', true),
  ('cosmetic', 'avatar-bolt', 'avatar', true),
  ('cosmetic', 'avatar-target', 'avatar', false),
  ('cosmetic', 'avatar-shield', 'avatar', false),
  ('cosmetic', 'avatar-crown', 'avatar', false),
  ('cosmetic', 'frame-plain', 'frame', true),
  ('cosmetic', 'frame-cyan', 'frame', false),
  ('cosmetic', 'frame-violet', 'frame', false),
  ('cosmetic', 'frame-gold', 'frame', false),
  ('cosmetic', 'bg-default', 'background', true),
  ('cosmetic', 'bg-dusk', 'background', false),
  ('cosmetic', 'bg-grid', 'background', false),
  ('cosmetic', 'bg-aurora', 'background', false),
  ('cosmetic', 'title-newcomer', 'title', true),
  ('cosmetic', 'title-first-steps', 'title', false),
  ('cosmetic', 'title-steady', 'title', false),
  ('cosmetic', 'title-rep-master', 'title', false),
  ('cosmetic', 'title-street-warrior', 'title', false),
  ('cosmetic', 'badge-standard', 'badge', true),
  ('cosmetic', 'badge-outline', 'badge', false),
  ('cosmetic', 'badge-gold', 'badge', false);

------------------------------------------------------------------------------
-- User tables
------------------------------------------------------------------------------

create table public.profiles (
  id                   uuid primary key references auth.users (id) on delete cascade,
  username             text check (username ~ '^[A-Za-z0-9_]{3,24}$'),
  email                text,
  onboarding_completed boolean     not null default false,
  onboarding_step      text        not null default 'character'
                       check (onboarding_step in ('character', 'goals', 'preferences', 'summary', 'done')),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  -- "done" and "completed" can never disagree.
  constraint profiles_done_consistent check ((onboarding_step = 'done') = onboarding_completed)
);
create unique index profiles_username_lower on public.profiles (lower(username)) where username is not null;

-- One character per user (unique user_id). level, current_xp and total_xp are written only by the XP trigger.
create table public.characters (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid        not null unique references auth.users (id) on delete cascade,
  character_name   text        not null check (char_length(btrim(character_name)) between 1 and 20),
  avatar_id        text        not null default 'avatar-user',
  cosmetic_options jsonb       not null default '{}'::jsonb check (jsonb_typeof(cosmetic_options) = 'object'),
  level            integer     not null default 1 check (level >= 1),
  current_xp       integer     not null default 0 check (current_xp >= 0),
  total_xp         integer     not null default 0 check (total_xp >= 0),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- Goals and training preferences. Columns stay null until the user answers them.
create table public.user_preferences (
  id                        uuid primary key default gen_random_uuid(),
  user_id                   uuid not null unique references auth.users (id) on delete cascade,
  primary_goal              text check (primary_goal in ('strength', 'skills', 'endurance', 'mobility', 'fat-loss', 'general')),
  secondary_goals           text[] not null default '{}'
                            check (secondary_goals <@ array['strength', 'skills', 'endurance', 'mobility', 'fat-loss', 'general']::text[]
                                   and cardinality(secondary_goals) <= 3),
  training_experience       text check (training_experience in ('beginner', 'intermediate', 'advanced')),
  training_environment      text check (training_environment in ('home', 'outdoor', 'gym', 'mixed')),
  available_equipment       text[] not null default '{}'
                            check (available_equipment <@ array['none', 'pullup-bar', 'bands', 'gym', 'parallel-bars', 'rings', 'other']::text[]
                                   and not ('none' = any (available_equipment) and cardinality(available_equipment) > 1)),
  weekly_training_frequency smallint check (weekly_training_frequency between 2 and 6),  -- 6 means "6 or more"
  preferred_workout_duration text check (preferred_workout_duration in ('15-20', '20-30', '30-45', '45-60', '60+')),
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  constraint prefs_primary_not_secondary check (primary_goal is null or not (primary_goal = any (secondary_goals)))
);

-- client_id is the id the browser gave the workout. (user_id, client_id) is the idempotency key.
create table public.workouts (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid        not null references auth.users (id) on delete cascade,
  client_id    text        not null check (char_length(client_id) between 1 and 80),
  workout_type text        not null check (workout_type ~ '^[a-z][a-z-]{0,19}$'),
  title        text        check (char_length(title) <= 120),
  duration     integer     not null check (duration between 0 and 21600),  -- seconds
  exercises    jsonb       not null check (jsonb_typeof(exercises) = 'array'),
  xp           integer     not null default 0 check (xp between 0 and 100000),
  imported     boolean     not null default false,  -- true: XP is part of the legacy import, not its own transaction
  details      jsonb       not null default '{}'::jsonb check (jsonb_typeof(details) = 'object' and pg_column_size(details) < 4096),
  completed_at timestamptz not null,
  created_at   timestamptz not null default now(),
  unique (user_id, client_id)
);
create index workouts_user_completed on public.workouts (user_id, completed_at desc);

create table public.quests (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid        not null references auth.users (id) on delete cascade,
  client_id   text        not null check (char_length(client_id) between 1 and 80),
  quest_date  date        not null,
  slot        text        not null references public.quest_reward_caps (slot),
  quest_type  text        not null default '' check (char_length(quest_type) <= 40),
  template_id text        not null check (char_length(template_id) <= 80),
  difficulty  smallint    not null check (difficulty between 1 and 3),
  title       text        not null check (char_length(title) <= 120),
  description text        not null default '' check (char_length(description) <= 240),
  metric      jsonb       not null check (jsonb_typeof(metric) = 'object' and pg_column_size(metric) < 2048),
  target      numeric     not null check (target > 0),
  status      text        not null default 'active' check (status in ('active', 'completed', 'expired')),
  reward_xp   integer     not null check (reward_xp between 0 and 1000),
  extra       jsonb       not null default '{}'::jsonb check (jsonb_typeof(extra) = 'object' and pg_column_size(extra) < 1024),  -- tier, generation version
  imported    boolean     not null default false,
  created_at  timestamptz not null default now(),
  completed_at timestamptz,
  unique (user_id, client_id)
);
create index quests_user_date on public.quests (user_id, quest_date desc);

-- Progress snapshot and reward state of a quest. reward_status 'granted' means the XP transaction exists.
create table public.quest_progress (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid        not null references auth.users (id) on delete cascade,
  quest_id      uuid        not null unique references public.quests (id) on delete cascade,
  progress      numeric     not null default 0 check (progress >= 0),
  reward_status text        not null default 'none' check (reward_status in ('none', 'eligible', 'granted')),
  updated_at    timestamptz not null default now()
);
create index quest_progress_user on public.quest_progress (user_id);

-- The XP ledger. Rows are inserted only by security definer functions.
create table public.xp_transactions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid        not null references auth.users (id) on delete cascade,
  source_type text        not null check (source_type in ('workout', 'quest', 'legacy_import')),
  source_id   text        not null check (char_length(source_id) between 1 and 80),
  xp_amount   integer     not null check (xp_amount between 1 and 10000000),
  created_at  timestamptz not null default now(),
  unique (user_id, source_type, source_id)
);
create index xp_transactions_user on public.xp_transactions (user_id, created_at);

create table public.achievements (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid        not null references auth.users (id) on delete cascade,
  kind           text        not null default 'achievement' check (kind = 'achievement'),
  achievement_id text        not null,
  unlocked_at    timestamptz not null default now(),
  unique (user_id, achievement_id),
  foreign key (kind, achievement_id) references public.unlock_catalog (kind, id)
);

create table public.cosmetics (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid        not null references auth.users (id) on delete cascade,
  kind        text        not null default 'cosmetic' check (kind = 'cosmetic'),
  cosmetic_id text        not null,
  unlocked_at timestamptz not null default now(),
  unique (user_id, cosmetic_id),
  foreign key (kind, cosmetic_id) references public.unlock_catalog (kind, id)
);

-- Things with no relational shape yet: weekly schedule, skill status, spent XP, non-XP baseline.
-- Not trusted for XP. Spent XP only affects which skills the user may open.
create table public.app_state (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  data       jsonb       not null default '{}'::jsonb check (jsonb_typeof(data) = 'object' and pg_column_size(data) < 200000),
  updated_at timestamptz not null default now()
);

create table public.policy_acceptances (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid        not null references auth.users (id) on delete cascade,
  policy_type text        not null,
  version     text        not null,
  accepted_at timestamptz not null default now(),
  unique (user_id, policy_type, version),
  foreign key (policy_type, version) references public.policy_versions (policy_type, version)
);
