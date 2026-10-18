CREATE TABLE `campaign_meta` (
	`campaign_id` text PRIMARY KEY NOT NULL,
	`customer_id` text NOT NULL,
	`name` text NOT NULL,
	`app_id` text,
	`status` text,
	`target_cpa_micros` integer,
	`target_roas` real,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
ALTER TABLE `revenue_daily` ADD `currency` text DEFAULT 'USD' NOT NULL;--> statement-breakpoint
ALTER TABLE `spend_daily` ADD `customer_id` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `spend_daily` ADD `currency` text DEFAULT 'USD' NOT NULL;--> statement-breakpoint
ALTER TABLE `spend_daily` ADD `conversions` real DEFAULT 0 NOT NULL;