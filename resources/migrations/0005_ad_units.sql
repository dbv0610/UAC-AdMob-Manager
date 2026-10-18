CREATE TABLE `revenue_unit_daily` (
	`date` text NOT NULL,
	`admob_app_id` text NOT NULL,
	`ad_unit_id` text NOT NULL,
	`ad_unit_name` text NOT NULL,
	`country` text NOT NULL,
	`format` text NOT NULL,
	`earnings_micros` integer DEFAULT 0 NOT NULL,
	`impressions` integer DEFAULT 0 NOT NULL,
	`requests` integer DEFAULT 0 NOT NULL,
	`matched` integer DEFAULT 0 NOT NULL,
	`clicks` integer DEFAULT 0 NOT NULL,
	`currency` text DEFAULT 'USD' NOT NULL,
	PRIMARY KEY(`date`, `ad_unit_id`, `country`)
);
--> statement-breakpoint
CREATE INDEX `revenue_unit_app_date` ON `revenue_unit_daily` (`admob_app_id`,`date`);