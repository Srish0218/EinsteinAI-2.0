-- Pin conversations in the EinsteinAI sidebar.
-- Run once in Supabase Dashboard > SQL Editor.
alter table public.conversations
    add column if not exists is_pinned boolean not null default false;
