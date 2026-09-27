-- Names, ethnicity, and phonetic code names on vehicles and persons of interest.

ALTER TABLE `ob_vehicles` ADD COLUMN `name` text;
ALTER TABLE `ob_vehicles` ADD COLUMN `identifier` text;
CREATE INDEX IF NOT EXISTS `ob_vehicles_identifier_idx` ON `ob_vehicles` (`identifier`);

ALTER TABLE `ob_persons` ADD COLUMN `name` text;
ALTER TABLE `ob_persons` ADD COLUMN `ethnicity` text;
ALTER TABLE `ob_persons` ADD COLUMN `identifier` text;
CREATE INDEX IF NOT EXISTS `ob_persons_identifier_idx` ON `ob_persons` (`identifier`);
