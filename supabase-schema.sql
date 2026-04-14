-- Robin DB schema (GDPR-compliant)

create extension if not exists "pgcrypto";

-- Users
create table if not exists users (
  user_id uuid primary key default gen_random_uuid(),
  email text unique,
  created_at timestamptz default now()
);

-- Consents (append-only log)
create table if not exists consents (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  type text not null,           -- 'profile_analysis', 'data_storage', etc.
  version text not null default '1.0',
  given_at timestamptz default now(),
  revoked_at timestamptz
);

-- Sessions (anonymous chat sessions)
create table if not exists sessions (
  session_id text primary key,
  user_id text,
  messages jsonb not null default '[]',
  facts jsonb not null default '[]',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Profiles (optional, user-uploaded context)
create table if not exists profiles (
  id uuid primary key default gen_random_uuid(),
  session_id text not null,
  summary text,
  facts jsonb default '[]',
  preferences jsonb default '{}',
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  delete_after timestamptz default now() + interval '30 days'
);

-- Sources (uploaded files / pasted text)
create table if not exists sources (
  source_id uuid primary key default gen_random_uuid(),
  session_id text not null,
  type text not null,           -- 'upload', 'paste', 'oauth'
  raw_data text,
  status text default 'active', -- 'active', 'deleted'
  created_at timestamptz default now(),
  delete_after timestamptz default now() + interval '30 days'
);

-- Actions (drafts + scheduled)
create table if not exists actions (
  id uuid primary key default gen_random_uuid(),
  session_id text not null,
  type text not null,           -- 'draft', 'scheduled'
  payload jsonb not null,
  status text default 'pending',
  scheduled_at timestamptz,
  created_at timestamptz default now()
);

-- Audit log (retained for legal, never deleted)
create table if not exists audit_log (
  id uuid primary key default gen_random_uuid(),
  session_id text,
  event text not null,          -- 'consent_given', 'data_deleted', 'export_requested'
  metadata jsonb,
  created_at timestamptz default now()
);

-- Auto-delete expired profiles/sources (run daily via cron or pg_cron)
create or replace function purge_expired_data() returns void as $$
begin
  update sources set status = 'deleted', raw_data = null where delete_after < now() and status = 'active';
  delete from profiles where delete_after < now();
end;
$$ language plpgsql;
