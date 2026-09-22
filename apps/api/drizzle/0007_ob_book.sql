-- Occurrence book (OB-BOOK-SPEC-001 v1.3)

CREATE TABLE IF NOT EXISTS `ob_suburbs` (
  `id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  `cpf_id` text NOT NULL REFERENCES `cpfs`(`id`) ON DELETE CASCADE,
  `name` text NOT NULL,
  `aliases` text NOT NULL DEFAULT '[]',
  `sort_order` integer NOT NULL DEFAULT 0,
  `created_at` text NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS `ob_suburbs_cpf_idx` ON `ob_suburbs` (`cpf_id`);
CREATE UNIQUE INDEX IF NOT EXISTS `ob_suburbs_name_idx` ON `ob_suburbs` (`cpf_id`, `name`);

CREATE TABLE IF NOT EXISTS `ob_security_companies` (
  `id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  `cpf_id` text NOT NULL REFERENCES `cpfs`(`id`) ON DELETE CASCADE,
  `name` text NOT NULL,
  `active` integer NOT NULL DEFAULT 1,
  `created_at` text NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS `ob_security_cpf_idx` ON `ob_security_companies` (`cpf_id`);
CREATE UNIQUE INDEX IF NOT EXISTS `ob_security_name_idx` ON `ob_security_companies` (`cpf_id`, `name`);

CREATE TABLE IF NOT EXISTS `ob_sequences` (
  `sector_id` text NOT NULL REFERENCES `sectors`(`id`) ON DELETE CASCADE,
  `year` integer NOT NULL,
  `last_seq` integer NOT NULL DEFAULT 0,
  PRIMARY KEY (`sector_id`, `year`)
);

CREATE TABLE IF NOT EXISTS `ob_entries` (
  `id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  `cpf_id` text NOT NULL REFERENCES `cpfs`(`id`) ON DELETE CASCADE,
  `sector_id` text NOT NULL REFERENCES `sectors`(`id`),
  `ob_number` text NOT NULL,
  `sequence` integer NOT NULL,
  `year` integer NOT NULL,
  `status` text NOT NULL DEFAULT 'active',
  `category` text NOT NULL,
  `phase` text,
  `danger_level` text,
  `occurred_at` text NOT NULL,
  `time_of_day` text NOT NULL,
  `day_of_week` text NOT NULL,
  `suburb_id` text REFERENCES `ob_suburbs`(`id`),
  `street` text NOT NULL DEFAULT '',
  `lat` real,
  `lng` real,
  `description` text NOT NULL DEFAULT '',
  `action_details` text NOT NULL DEFAULT '',
  `received_from` text NOT NULL DEFAULT '[]',
  `attendance` text,
  `conclusion` text,
  `closed_at` text,
  `closed_by_id` text REFERENCES `patrollers`(`id`) ON DELETE SET NULL,
  `captured_by_id` text REFERENCES `patrollers`(`id`) ON DELETE SET NULL,
  `call_sign` text NOT NULL,
  `created_at` text NOT NULL DEFAULT (datetime('now')),
  `updated_at` text NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS `ob_entries_number_idx` ON `ob_entries` (`cpf_id`, `ob_number`);
CREATE INDEX IF NOT EXISTS `ob_entries_sector_status_idx` ON `ob_entries` (`sector_id`, `status`);
CREATE INDEX IF NOT EXISTS `ob_entries_occurred_idx` ON `ob_entries` (`cpf_id`, `occurred_at`);

CREATE TABLE IF NOT EXISTS `ob_entry_types` (
  `id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  `entry_id` text NOT NULL REFERENCES `ob_entries`(`id`) ON DELETE CASCADE,
  `type_key` text NOT NULL,
  `is_primary` integer NOT NULL DEFAULT 0,
  `sort_order` integer NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS `ob_entry_types_entry_idx` ON `ob_entry_types` (`entry_id`);

CREATE TABLE IF NOT EXISTS `ob_entry_services` (
  `id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  `entry_id` text NOT NULL REFERENCES `ob_entries`(`id`) ON DELETE CASCADE,
  `service_key` text NOT NULL,
  `security_company_id` text REFERENCES `ob_security_companies`(`id`) ON DELETE SET NULL,
  `reference` text,
  `other_name` text
);
CREATE INDEX IF NOT EXISTS `ob_entry_services_entry_idx` ON `ob_entry_services` (`entry_id`);

CREATE TABLE IF NOT EXISTS `ob_entry_responders` (
  `entry_id` text NOT NULL REFERENCES `ob_entries`(`id`) ON DELETE CASCADE,
  `patroller_id` text NOT NULL REFERENCES `patrollers`(`id`) ON DELETE CASCADE,
  PRIMARY KEY (`entry_id`, `patroller_id`)
);

CREATE TABLE IF NOT EXISTS `ob_entry_tags` (
  `entry_id` text NOT NULL REFERENCES `ob_entries`(`id`) ON DELETE CASCADE,
  `tag_key` text NOT NULL,
  PRIMARY KEY (`entry_id`, `tag_key`)
);

CREATE TABLE IF NOT EXISTS `ob_vehicles` (
  `id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  `entry_id` text NOT NULL REFERENCES `ob_entries`(`id`) ON DELETE CASCADE,
  `colour` text,
  `shape` text,
  `make` text,
  `model` text,
  `registration` text,
  `features` text
);
CREATE INDEX IF NOT EXISTS `ob_vehicles_entry_idx` ON `ob_vehicles` (`entry_id`);
CREATE INDEX IF NOT EXISTS `ob_vehicles_reg_idx` ON `ob_vehicles` (`registration`);

CREATE TABLE IF NOT EXISTS `ob_persons` (
  `id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  `entry_id` text NOT NULL REFERENCES `ob_entries`(`id`) ON DELETE CASCADE,
  `kind` text NOT NULL,
  `gender` text,
  `clothing` text,
  `direction` text,
  `injury_tag` text,
  `note` text
);
CREATE INDEX IF NOT EXISTS `ob_persons_entry_idx` ON `ob_persons` (`entry_id`);

CREATE TABLE IF NOT EXISTS `ob_sightings` (
  `id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  `entry_id` text NOT NULL REFERENCES `ob_entries`(`id`) ON DELETE CASCADE,
  `suburb_id` text REFERENCES `ob_suburbs`(`id`),
  `street` text NOT NULL DEFAULT '',
  `seen_at` text NOT NULL,
  `note` text,
  `reported_by_id` text REFERENCES `patrollers`(`id`) ON DELETE SET NULL,
  `call_sign` text NOT NULL,
  `created_at` text NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS `ob_sightings_entry_idx` ON `ob_sightings` (`entry_id`, `seen_at`);
