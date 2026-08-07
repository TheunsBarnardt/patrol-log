CREATE TABLE IF NOT EXISTS `hotspots` (
  `id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  `cpf_id` text NOT NULL REFERENCES `cpfs`(`id`) ON DELETE CASCADE,
  `sector_id` text NOT NULL REFERENCES `sectors`(`id`),
  `title` text NOT NULL,
  `description` text NOT NULL DEFAULT '',
  `rating` integer NOT NULL DEFAULT 3,
  `diameter_km` real NOT NULL DEFAULT 0.5,
  `lat` real NOT NULL,
  `lng` real NOT NULL,
  `created_at` text NOT NULL DEFAULT (datetime('now')),
  `updated_at` text NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS `hotspots_cpf_idx` ON `hotspots` (`cpf_id`);
CREATE INDEX IF NOT EXISTS `hotspots_sector_idx` ON `hotspots` (`sector_id`);
