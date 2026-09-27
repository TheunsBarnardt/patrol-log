-- Needle training examples from desk thumbs up / thumbs down.

CREATE TABLE IF NOT EXISTS `ob_needle_examples` (
  `id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  `cpf_id` text NOT NULL REFERENCES `cpfs`(`id`) ON DELETE CASCADE,
  `passage` text NOT NULL,
  `messages_json` text NOT NULL DEFAULT '[]',
  `needle_fill_json` text NOT NULL DEFAULT '{}',
  `corrected_fill_json` text,
  `vote` text NOT NULL,
  `notes` text NOT NULL DEFAULT '',
  `created_by_id` text REFERENCES `patrollers`(`id`) ON DELETE SET NULL,
  `created_at` text NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS `ob_needle_examples_cpf_idx` ON `ob_needle_examples` (`cpf_id`, `created_at`);
CREATE INDEX IF NOT EXISTS `ob_needle_examples_vote_idx` ON `ob_needle_examples` (`cpf_id`, `vote`);
