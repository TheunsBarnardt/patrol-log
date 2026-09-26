-- Patrols that responded to an occurrence book incident.

CREATE TABLE IF NOT EXISTS `ob_entry_patrols` (
  `entry_id` text NOT NULL REFERENCES `ob_entries`(`id`) ON DELETE CASCADE,
  `patrol_id` text NOT NULL REFERENCES `patrols`(`id`) ON DELETE CASCADE,
  PRIMARY KEY (`entry_id`, `patrol_id`)
);
