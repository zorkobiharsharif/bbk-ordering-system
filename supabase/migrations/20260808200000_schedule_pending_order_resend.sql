-- Runs resend-pending-order-alerts every minute so an unhandled order keeps
-- re-pushing to owner/staff phones instead of alerting once and going
-- silent. The function itself only ever touches orders still "new" or
-- "address_needs_check" within the last 20 minutes, so this schedule can
-- run forever without needing to know anything about when to stop.
create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

select cron.unschedule('resend-pending-order-alerts') where exists (select 1 from cron.job where jobname = 'resend-pending-order-alerts');

select cron.schedule(
  'resend-pending-order-alerts',
  '* * * * *',
  $$
  select net.http_post(
    url := 'https://agdmbhmrxfancjuguizk.supabase.co/functions/v1/resend-pending-order-alerts',
    headers := jsonb_build_object('apikey', 'sb_publishable_M2NLbiwwEmLY-FhsDViPWw_4EypahWG', 'Content-Type', 'application/json'),
    body := '{}'::jsonb
  );
  $$
);
