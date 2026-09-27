-- Historical train-only corpus + richer Needle example metrics.

ALTER TABLE `ob_needle_examples` ADD COLUMN `source` text NOT NULL DEFAULT 'live';
ALTER TABLE `ob_needle_examples` ADD COLUMN `field_score` integer;
ALTER TABLE `ob_needle_examples` ADD COLUMN `corpus_id` text;
CREATE INDEX IF NOT EXISTS `ob_needle_examples_source_idx` ON `ob_needle_examples` (`cpf_id`, `source`);

CREATE TABLE IF NOT EXISTS `ob_needle_corpus` (
  `id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  `cpf_id` text NOT NULL REFERENCES `cpfs`(`id`) ON DELETE CASCADE,
  `passage` text NOT NULL,
  `label` text NOT NULL DEFAULT '',
  `status` text NOT NULL DEFAULT 'pending',
  `last_needle_fill_json` text,
  `last_vote` text,
  `example_id` text,
  `reviewed_at` text,
  `created_by_id` text REFERENCES `patrollers`(`id`) ON DELETE SET NULL,
  `created_at` text NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS `ob_needle_corpus_cpf_status_idx` ON `ob_needle_corpus` (`cpf_id`, `status`, `created_at`);
