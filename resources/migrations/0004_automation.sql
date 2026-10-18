CREATE TABLE `rule_suggestions` (
	`id` text PRIMARY KEY NOT NULL,
	`rule_id` text NOT NULL,
	`customer_id` text NOT NULL,
	`campaign_id` text NOT NULL,
	`json` text NOT NULL,
	`status` text NOT NULL,
	`error` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`decided_at` text
);
--> statement-breakpoint
CREATE INDEX `suggest_status` ON `rule_suggestions` (`status`,`created_at`);--> statement-breakpoint
ALTER TABLE `campaign_meta` ADD `budget_micros` integer;--> statement-breakpoint
ALTER TABLE `campaign_meta` ADD `budget_resource` text;--> statement-breakpoint
ALTER TABLE `campaign_meta` ADD `budget_shared` integer;