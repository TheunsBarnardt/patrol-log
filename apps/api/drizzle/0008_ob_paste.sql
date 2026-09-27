-- Pasted messages that fill one occurrence-book entry.

ALTER TABLE `ob_entries` ADD COLUMN `source` text NOT NULL DEFAULT 'manual';

CREATE TABLE IF NOT EXISTS `ob_paste_groups` (
  `id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  `cpf_id` text NOT NULL REFERENCES `cpfs`(`id`) ON DELETE CASCADE,
  `sector_id` text NOT NULL REFERENCES `sectors`(`id`),
  `name` text NOT NULL,
  `received_from` text NOT NULL,
  `created_at` text NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS `ob_paste_groups_cpf_idx` ON `ob_paste_groups` (`cpf_id`);
CREATE UNIQUE INDEX IF NOT EXISTS `ob_paste_groups_name_idx` ON `ob_paste_groups` (`cpf_id`, `name`);

CREATE TABLE IF NOT EXISTS `ob_entry_messages` (
  `id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  `cpf_id` text NOT NULL REFERENCES `cpfs`(`id`) ON DELETE CASCADE,
  `entry_id` text NOT NULL REFERENCES `ob_entries`(`id`) ON DELETE CASCADE,
  `group_id` text REFERENCES `ob_paste_groups`(`id`) ON DELETE SET NULL,
  `body_hash` text NOT NULL,
  `body` text NOT NULL,
  `created_at` text NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS `ob_entry_messages_entry_idx` ON `ob_entry_messages` (`entry_id`, `created_at`);
CREATE UNIQUE INDEX IF NOT EXISTS `ob_entry_messages_hash_idx` ON `ob_entry_messages` (`cpf_id`, `body_hash`);
