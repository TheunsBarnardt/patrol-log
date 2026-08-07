-- Seed-safe backup store. Seed scripts MUST NEVER DELETE FROM system_backups.
CREATE TABLE IF NOT EXISTS `system_backups` (
  `id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  `created_at` text NOT NULL DEFAULT (datetime('now')),
  `created_by_call_sign` text NOT NULL,
  `created_by_patroller_id` text,
  `label` text,
  `byte_size` integer NOT NULL DEFAULT 0,
  `table_counts` text,
  `payload` text NOT NULL
);
CREATE INDEX IF NOT EXISTS `system_backups_created_idx` ON `system_backups` (`created_at`);
