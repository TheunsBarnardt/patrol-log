-- Extra occurrence-book tags added by the desk, kept per CPF.

CREATE TABLE IF NOT EXISTS `ob_tags` (
  `id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  `cpf_id` text NOT NULL REFERENCES `cpfs`(`id`) ON DELETE CASCADE,
  `key` text NOT NULL,
  `label` text NOT NULL,
  `created_at` text NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS `ob_tags_cpf_idx` ON `ob_tags` (`cpf_id`);
CREATE UNIQUE INDEX IF NOT EXISTS `ob_tags_key_idx` ON `ob_tags` (`cpf_id`, `key`);
CREATE UNIQUE INDEX IF NOT EXISTS `ob_tags_label_idx` ON `ob_tags` (`cpf_id`, `label`);
