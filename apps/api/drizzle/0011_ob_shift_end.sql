-- Call-centre shift window. The book row closes itself when this SAST time is reached.

ALTER TABLE `ob_entries` ADD COLUMN `shift_ends_at` text;
