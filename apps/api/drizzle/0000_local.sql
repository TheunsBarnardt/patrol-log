PRAGMA foreign_keys=OFF;
CREATE TABLE `audit_log` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))) NOT NULL,
	`actor_patroller_id` text,
	`action` text NOT NULL,
	`payload` text,
	`ip` text,
	`device_id` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`actor_patroller_id`) REFERENCES `patrollers`(`id`) ON UPDATE no action ON DELETE no action
);
CREATE TABLE `cpfs` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))) NOT NULL,
	`name` text NOT NULL,
	`province` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
CREATE TABLE `devices` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))) NOT NULL,
	`device_id` text NOT NULL,
	`patroller_id` text NOT NULL,
	`token_jti` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`user_agent` text,
	`last_seen_at` text DEFAULT (datetime('now')) NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`patroller_id`) REFERENCES `patrollers`(`id`) ON UPDATE no action ON DELETE cascade
);
CREATE TABLE `emergency_services` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))) NOT NULL,
	`cpf_id` text NOT NULL,
	`name` text NOT NULL,
	`service_type` text NOT NULL,
	`primary_number` text NOT NULL,
	`secondary_number` text,
	`address` text,
	`sector_ids` text DEFAULT '[]',
	`priority` integer DEFAULT 100 NOT NULL,
	`sensitive` integer DEFAULT 0 NOT NULL,
	`verified_at` text DEFAULT (datetime('now')) NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`cpf_id`) REFERENCES `cpfs`(`id`) ON UPDATE no action ON DELETE cascade
);
CREATE TABLE `incidents` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))) NOT NULL,
	`cpf_id` text NOT NULL,
	`sector_id` text,
	`type` text NOT NULL,
	`severity` text NOT NULL,
	`lat` real NOT NULL,
	`lng` real NOT NULL,
	`occurred_at` text NOT NULL,
	`description` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`cpf_id`) REFERENCES `cpfs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`sector_id`) REFERENCES `sectors`(`id`) ON UPDATE no action ON DELETE no action
);
CREATE TABLE `live_pins` (
	`patrol_id` text PRIMARY KEY NOT NULL,
	`cpf_id` text NOT NULL,
	`sector_id` text NOT NULL,
	`call_sign` text NOT NULL,
	`lat` real NOT NULL,
	`lng` real NOT NULL,
	`heading` real,
	`speed` real,
	`accuracy_m` real NOT NULL,
	`last_seen_at` text DEFAULT (datetime('now')) NOT NULL,
	`out_of_sector` integer DEFAULT 0 NOT NULL,
	`last_out_of_sector_alert_at` text,
	FOREIGN KEY (`patrol_id`) REFERENCES `patrols`(`id`) ON UPDATE no action ON DELETE cascade
);
CREATE TABLE `login_attempts` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))) NOT NULL,
	`call_sign` text NOT NULL,
	`ip` text,
	`device_id` text,
	`outcome` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
CREATE TABLE `message_channel_members` (
	`channel_id` text NOT NULL,
	`patroller_id` text NOT NULL,
	PRIMARY KEY(`channel_id`, `patroller_id`),
	FOREIGN KEY (`channel_id`) REFERENCES `message_channels`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`patroller_id`) REFERENCES `patrollers`(`id`) ON UPDATE no action ON DELETE cascade
);
CREATE TABLE `message_channels` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))) NOT NULL,
	`cpf_id` text NOT NULL,
	`type` text NOT NULL,
	`name` text NOT NULL,
	`sector_id` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`cpf_id`) REFERENCES `cpfs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`sector_id`) REFERENCES `sectors`(`id`) ON UPDATE no action ON DELETE set null
);
CREATE TABLE `message_reads` (
	`message_id` text NOT NULL,
	`patroller_id` text NOT NULL,
	`read_at` text DEFAULT (datetime('now')) NOT NULL,
	PRIMARY KEY(`message_id`, `patroller_id`),
	FOREIGN KEY (`message_id`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`patroller_id`) REFERENCES `patrollers`(`id`) ON UPDATE no action ON DELETE cascade
);
CREATE TABLE `messages` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))) NOT NULL,
	`channel_id` text NOT NULL,
	`sender_id` text,
	`sender_call_sign` text NOT NULL,
	`body` text NOT NULL,
	`priority` text DEFAULT 'normal' NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`channel_id`) REFERENCES `message_channels`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`sender_id`) REFERENCES `patrollers`(`id`) ON UPDATE no action ON DELETE set null
);
CREATE TABLE `next_of_kin` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))) NOT NULL,
	`patroller_id` text NOT NULL,
	`name` text NOT NULL,
	`relationship` text NOT NULL,
	`phone` text NOT NULL,
	`alternate_phone` text,
	FOREIGN KEY (`patroller_id`) REFERENCES `patrollers`(`id`) ON UPDATE no action ON DELETE cascade
);
CREATE TABLE `patrol_breadcrumbs` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))) NOT NULL,
	`patrol_id` text NOT NULL,
	`lat` real NOT NULL,
	`lng` real NOT NULL,
	`heading` real,
	`speed` real,
	`accuracy_m` real NOT NULL,
	`recorded_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`patrol_id`) REFERENCES `patrols`(`id`) ON UPDATE no action ON DELETE cascade
);
CREATE TABLE `patrol_escalation_events` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))) NOT NULL,
	`patrol_id` text NOT NULL,
	`actor_patroller_id` text NOT NULL,
	`service_id` text NOT NULL,
	`service_name` text NOT NULL,
	`service_type` text NOT NULL,
	`called_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`patrol_id`) REFERENCES `patrols`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`actor_patroller_id`) REFERENCES `patrollers`(`id`) ON UPDATE no action ON DELETE no action
);
CREATE TABLE `patrol_members` (
	`patrol_id` text NOT NULL,
	`patroller_id` text NOT NULL,
	`role` text NOT NULL,
	`start_time` text DEFAULT (datetime('now')) NOT NULL,
	`end_time` text,
	`end_lat` real,
	`end_lng` real,
	PRIMARY KEY(`patrol_id`, `patroller_id`),
	FOREIGN KEY (`patrol_id`) REFERENCES `patrols`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`patroller_id`) REFERENCES `patrollers`(`id`) ON UPDATE no action ON DELETE no action
);
CREATE TABLE `patrollers` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))) NOT NULL,
	`call_sign` text NOT NULL,
	`name` text NOT NULL,
	`phone` text,
	`address` text,
	`password_hash` text NOT NULL,
	`access_level` text DEFAULT 'patroller' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`cpf_id` text NOT NULL,
	`sector_id` text NOT NULL,
	`failed_login_attempts` integer DEFAULT 0 NOT NULL,
	`locked_until` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`cpf_id`) REFERENCES `cpfs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`sector_id`) REFERENCES `sectors`(`id`) ON UPDATE no action ON DELETE no action
);
CREATE TABLE `patrols` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))) NOT NULL,
	`cpf_id` text NOT NULL,
	`sector_id` text NOT NULL,
	`primary_patroller_id` text NOT NULL,
	`patrol_type` text NOT NULL,
	`vehicle_id` text,
	`odometer_start` integer,
	`odometer_end` integer,
	`distance_km` integer,
	`start_time` text DEFAULT (datetime('now')) NOT NULL,
	`end_time` text,
	`start_lat` real,
	`start_lng` real,
	`start_accuracy_m` real,
	`end_lat` real,
	`end_lng` real,
	`end_accuracy_m` real,
	`sars_purpose` text DEFAULT 'CPF sector patrol' NOT NULL,
	`sars_compliant` integer DEFAULT 0 NOT NULL,
	`state` text DEFAULT 'active' NOT NULL,
	`reason` text,
	`record_seal_hash` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`cpf_id`) REFERENCES `cpfs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`sector_id`) REFERENCES `sectors`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`primary_patroller_id`) REFERENCES `patrollers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`vehicle_id`) REFERENCES `vehicles`(`id`) ON UPDATE no action ON DELETE no action
);
CREATE TABLE `push_tokens` (
	`patroller_id` text PRIMARY KEY NOT NULL,
	`expo_token` text NOT NULL,
	`platform` text NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`patroller_id`) REFERENCES `patrollers`(`id`) ON UPDATE no action ON DELETE cascade
);
CREATE TABLE `residents` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))) NOT NULL,
	`cpf_id` text NOT NULL,
	`sector_id` text NOT NULL,
	`name` text NOT NULL,
	`phone` text NOT NULL,
	`address` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`cpf_id`) REFERENCES `cpfs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`sector_id`) REFERENCES `sectors`(`id`) ON UPDATE no action ON DELETE no action
);
CREATE TABLE `sectors` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))) NOT NULL,
	`cpf_id` text NOT NULL,
	`name` text NOT NULL,
	`boundaries` text DEFAULT 'null',
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`cpf_id`) REFERENCES `cpfs`(`id`) ON UPDATE no action ON DELETE cascade
);
CREATE TABLE `vehicles` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))) NOT NULL,
	`cpf_id` text NOT NULL,
	`sector_id` text,
	`patroller_id` text,
	`registration` text NOT NULL,
	`description` text,
	`last_odometer` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'available' NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`cpf_id`) REFERENCES `cpfs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`sector_id`) REFERENCES `sectors`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`patroller_id`) REFERENCES `patrollers`(`id`) ON UPDATE no action ON DELETE set null
);
CREATE INDEX `audit_actor_idx` ON `audit_log` (`actor_patroller_id`,`created_at`);CREATE INDEX `audit_action_idx` ON `audit_log` (`action`,`created_at`);CREATE INDEX `devices_patroller_idx` ON `devices` (`patroller_id`);CREATE UNIQUE INDEX `devices_patroller_device_idx` ON `devices` (`patroller_id`,`device_id`);CREATE INDEX `emergency_services_cpf_idx` ON `emergency_services` (`cpf_id`);CREATE INDEX `incidents_occurred_idx` ON `incidents` (`occurred_at`);CREATE INDEX `incidents_cpf_idx` ON `incidents` (`cpf_id`);CREATE INDEX `live_pins_cpf_sector_idx` ON `live_pins` (`cpf_id`,`sector_id`);CREATE INDEX `live_pins_last_seen_idx` ON `live_pins` (`last_seen_at`);CREATE INDEX `login_attempts_callsign_idx` ON `login_attempts` (`call_sign`,`created_at`);CREATE INDEX `login_attempts_ip_idx` ON `login_attempts` (`ip`,`created_at`);CREATE INDEX `msg_channels_cpf_idx` ON `message_channels` (`cpf_id`);CREATE INDEX `msg_channels_sector_idx` ON `message_channels` (`sector_id`);CREATE INDEX `msg_reads_patroller_idx` ON `message_reads` (`patroller_id`);CREATE INDEX `messages_channel_idx` ON `messages` (`channel_id`,`created_at`);CREATE INDEX `nok_patroller_idx` ON `next_of_kin` (`patroller_id`);CREATE INDEX `breadcrumbs_patrol_idx` ON `patrol_breadcrumbs` (`patrol_id`,`recorded_at`);CREATE INDEX `escalation_patrol_idx` ON `patrol_escalation_events` (`patrol_id`);CREATE INDEX `patrol_members_active_by_patroller_idx` ON `patrol_members` (`patroller_id`,`end_time`);CREATE UNIQUE INDEX `patrollers_callsign_cpf_idx` ON `patrollers` (`call_sign`,`cpf_id`);CREATE INDEX `patrollers_sector_idx` ON `patrollers` (`sector_id`);CREATE INDEX `patrols_cpf_state_idx` ON `patrols` (`cpf_id`,`state`);CREATE INDEX `patrols_sector_active_idx` ON `patrols` (`sector_id`,`state`);CREATE INDEX `patrols_primary_idx` ON `patrols` (`primary_patroller_id`,`state`);CREATE INDEX `patrols_vehicle_idx` ON `patrols` (`vehicle_id`,`state`);CREATE INDEX `residents_sector_idx` ON `residents` (`sector_id`);CREATE INDEX `residents_name_idx` ON `residents` (`name`);CREATE INDEX `sectors_cpf_idx` ON `sectors` (`cpf_id`);CREATE INDEX `vehicles_cpf_idx` ON `vehicles` (`cpf_id`);CREATE UNIQUE INDEX `vehicles_reg_cpf_idx` ON `vehicles` (`registration`,`cpf_id`);CREATE INDEX `vehicles_patroller_idx` ON `vehicles` (`patroller_id`);
PRAGMA foreign_keys=ON;
