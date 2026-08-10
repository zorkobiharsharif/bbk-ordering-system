-- Telegram chat IDs to alert on new orders — a free, more reliable
-- alternative/backup to push notifications (native app, no browser/OS
-- background-kill issues to fight). Small, rarely-changing list (owner +
-- staff), so a plain array column is simpler than a whole new table.
alter table public.business_settings add column if not exists telegram_chat_ids bigint[] not null default '{}';

update public.business_settings set telegram_chat_ids = array[1220010845]::bigint[] where id = true;
