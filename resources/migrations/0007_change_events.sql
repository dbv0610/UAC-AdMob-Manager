CREATE TABLE `change_events` (
	`id` text PRIMARY KEY NOT NULL,
	`customer_id` text NOT NULL,
	`at` text NOT NULL,
	`date` text NOT NULL,
	`campaign_id` text,
	`resource_type` text NOT NULL,
	`operation` text NOT NULL,
	`client_type` text NOT NULL,
	`user_email` text,
	`fields` text NOT NULL,
	`details` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `change_customer_date` ON `change_events` (`customer_id`,`date`);--> statement-breakpoint
CREATE INDEX `change_campaign` ON `change_events` (`campaign_id`);