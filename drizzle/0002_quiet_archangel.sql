CREATE TABLE `recurring_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`column_id` text NOT NULL,
	`title` text NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`priority` text DEFAULT 'none' NOT NULL,
	`freq_type` text DEFAULT 'daily' NOT NULL,
	`freq_interval` integer DEFAULT 1 NOT NULL,
	`day_of_week` integer,
	`day_of_month` integer,
	`last_generated_date` text,
	`active` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`column_id`) REFERENCES `columns`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_recurring_project` ON `recurring_tasks` (`project_id`);