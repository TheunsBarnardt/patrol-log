-- Seed script for D1 (SQLite). Run with:
--   wrangler d1 execute <db-name> --remote -f seed.sql
-- OR locally:
--   npx wrangler d1 execute patrol-log-db --local -f seed.sql

-- First truncate all tables (dependency order)
DELETE FROM message_channel_members;
DELETE FROM message_reads;
DELETE FROM messages;
DELETE FROM message_channels;
DELETE FROM push_tokens;
DELETE FROM audit_log;
DELETE FROM incidents;
DELETE FROM emergency_services;
DELETE FROM residents;
DELETE FROM patrol_breadcrumbs;
DELETE FROM patrol_escalation_events;
DELETE FROM patrol_members;
DELETE FROM patrols;
DELETE FROM vehicles;
DELETE FROM devices;
DELETE FROM login_attempts;
DELETE FROM next_of_kin;
DELETE FROM patrollers;
DELETE FROM sectors;
DELETE FROM cpfs;
DELETE FROM live_pins;

-- Insert CPF + sector
INSERT INTO cpfs (id, name, province) VALUES (
  lower(hex(randomblob(16))), 'Wierdabrug CPF', 'Gauteng'
);
-- Note: we need the CPF ID for subsequent inserts. 
-- For a proper seed we'd use a variable, but SQLite in D1 doesn't support session vars well.
-- So we use a two-step approach: first insert CPF, then get its ID.
