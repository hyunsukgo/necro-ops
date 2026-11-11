CREATE TABLE `connector_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`incident_id` text NOT NULL,
	`connector` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`error` text,
	`started_at` text,
	`finished_at` text,
	`item_count` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`incident_id`) REFERENCES `incidents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `events` (
	`id` text PRIMARY KEY NOT NULL,
	`incident_id` text NOT NULL,
	`source` text NOT NULL,
	`ts` text NOT NULL,
	`kind` text NOT NULL,
	`severity` text NOT NULL,
	`entities_json` text DEFAULT '[]' NOT NULL,
	`summary` text NOT NULL,
	`link` text,
	`raw_json` text DEFAULT 'null' NOT NULL,
	FOREIGN KEY (`incident_id`) REFERENCES `incidents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `incidents` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`start_at` text NOT NULL,
	`end_at` text NOT NULL,
	`services_json` text DEFAULT '[]' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `reports` (
	`incident_id` text PRIMARY KEY NOT NULL,
	`body_json` text NOT NULL,
	`is_draft` integer DEFAULT true NOT NULL,
	`generated_by` text DEFAULT 'template' NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`incident_id`) REFERENCES `incidents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `timelines` (
	`incident_id` text PRIMARY KEY NOT NULL,
	`clusters_json` text DEFAULT '[]' NOT NULL,
	`suspected_trigger_id` text,
	`built_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`incident_id`) REFERENCES `incidents`(`id`) ON UPDATE no action ON DELETE cascade
);
