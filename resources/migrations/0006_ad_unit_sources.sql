CREATE TABLE `revenue_unit_source_daily` (
	`date` text NOT NULL,
	`admob_app_id` text NOT NULL,
	`ad_unit_id` text NOT NULL,
	`ad_source` text NOT NULL,
	`earnings_micros` integer DEFAULT 0 NOT NULL,
	`impressions` integer DEFAULT 0 NOT NULL,
	`requests` integer DEFAULT 0 NOT NULL,
	`matched` integer DEFAULT 0 NOT NULL,
	`clicks` integer DEFAULT 0 NOT NULL,
	`currency` text DEFAULT 'USD' NOT NULL,
	PRIMARY KEY(`date`, `ad_unit_id`, `ad_source`)
);
--> statement-breakpoint
CREATE INDEX `revenue_unit_source_unit_date` ON `revenue_unit_source_daily` (`ad_unit_id`,`date`);