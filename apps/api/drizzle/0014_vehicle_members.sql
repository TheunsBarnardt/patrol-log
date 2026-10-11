-- Shared vehicles: multiple members can be assigned to one vehicle.

CREATE TABLE IF NOT EXISTS `vehicle_members` (
  `vehicle_id` text NOT NULL REFERENCES `vehicles`(`id`) ON DELETE CASCADE,
  `patroller_id` text NOT NULL REFERENCES `patrollers`(`id`) ON DELETE CASCADE,
  PRIMARY KEY (`vehicle_id`, `patroller_id`)
);
CREATE INDEX IF NOT EXISTS `vehicle_members_patroller_idx` ON `vehicle_members` (`patroller_id`);

-- Backfill from legacy single assignee column.
INSERT OR IGNORE INTO `vehicle_members` (`vehicle_id`, `patroller_id`)
SELECT `id`, `patroller_id` FROM `vehicles` WHERE `patroller_id` IS NOT NULL;
