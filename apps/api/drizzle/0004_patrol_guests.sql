CREATE TABLE IF NOT EXISTS `patrol_guests` (
  `id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  `patrol_id` text NOT NULL REFERENCES `patrols`(`id`) ON DELETE CASCADE,
  `display_name` text NOT NULL,
  `note` text,
  `added_by_patroller_id` text NOT NULL REFERENCES `patrollers`(`id`),
  `created_at` text NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS `patrol_guests_patrol_idx` ON `patrol_guests` (`patrol_id`);
