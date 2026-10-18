CREATE TABLE `accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`kind` text NOT NULL,
	`scopes` text NOT NULL,
	`refresh_token_enc` text,
	`status` text DEFAULT 'active' NOT NULL,
	`meta` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `ads_customers` (
	`customer_id` text PRIMARY KEY NOT NULL,
	`login_customer_id` text,
	`account_id` text NOT NULL,
	`name` text NOT NULL,
	`currency` text NOT NULL,
	`time_zone` text NOT NULL,
	`manager` integer DEFAULT false NOT NULL,
	`level` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `apps` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`store` text NOT NULL,
	`store_app_id` text NOT NULL,
	`admob_app_id` text,
	`ads_customer_id` text,
	`roas_target` real
);
--> statement-breakpoint
CREATE UNIQUE INDEX `apps_store_app_id_unique` ON `apps` (`store_app_id`);--> statement-breakpoint
CREATE TABLE `assets` (
	`customer_id` text NOT NULL,
	`creative_id` text NOT NULL,
	`asset_resource_name` text NOT NULL,
	`type` text NOT NULL,
	PRIMARY KEY(`customer_id`, `creative_id`)
);
--> statement-breakpoint
CREATE TABLE `audit_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`actor` text NOT NULL,
	`entity` text NOT NULL,
	`entity_id` text NOT NULL,
	`before` text,
	`after` text,
	`request_id` text
);
--> statement-breakpoint
CREATE TABLE `campaigns` (
	`id` text PRIMARY KEY NOT NULL,
	`plan_id` text,
	`customer_id` text NOT NULL,
	`name` text NOT NULL,
	`country` text NOT NULL,
	`goal` text NOT NULL,
	`status` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `creatives` (
	`id` text PRIMARY KEY NOT NULL,
	`path` text NOT NULL,
	`sha256` text NOT NULL,
	`kind` text NOT NULL,
	`duration_s` real,
	`width` integer,
	`height` integer,
	`aspect` text,
	`countries` text DEFAULT '[]' NOT NULL,
	`youtube_id` text,
	`status` text DEFAULT 'LOCAL' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `creatives_sha256_unique` ON `creatives` (`sha256`);--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`state` text NOT NULL,
	`payload` text,
	`progress` text,
	`error` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `plans` (
	`id` text NOT NULL,
	`app_id` text NOT NULL,
	`version` integer NOT NULL,
	`json` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	PRIMARY KEY(`id`, `version`)
);
--> statement-breakpoint
CREATE TABLE `quota_usage` (
	`day` text NOT NULL,
	`api` text NOT NULL,
	`used` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`day`, `api`)
);
--> statement-breakpoint
CREATE TABLE `revenue_daily` (
	`date` text NOT NULL,
	`admob_app_id` text NOT NULL,
	`country` text NOT NULL,
	`format` text NOT NULL,
	`ad_source` text NOT NULL,
	`earnings_micros` integer DEFAULT 0 NOT NULL,
	`impressions` integer DEFAULT 0 NOT NULL,
	`requests` integer DEFAULT 0 NOT NULL,
	`matched` integer DEFAULT 0 NOT NULL,
	`clicks` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`date`, `admob_app_id`, `country`, `format`, `ad_source`)
);
--> statement-breakpoint
CREATE INDEX `revenue_app_date` ON `revenue_daily` (`admob_app_id`,`date`);--> statement-breakpoint
CREATE TABLE `rules` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`json` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`last_run_at` text
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `spend_daily` (
	`date` text NOT NULL,
	`campaign_id` text NOT NULL,
	`country` text NOT NULL,
	`app_id` text NOT NULL,
	`cost_micros` integer DEFAULT 0 NOT NULL,
	`installs` real DEFAULT 0 NOT NULL,
	`clicks` integer DEFAULT 0 NOT NULL,
	`impressions` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`date`, `campaign_id`, `country`)
);
--> statement-breakpoint
CREATE INDEX `spend_app_date` ON `spend_daily` (`app_id`,`date`);--> statement-breakpoint
CREATE TABLE `texts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`app_id` text NOT NULL,
	`lang` text NOT NULL,
	`field` text NOT NULL,
	`text` text NOT NULL,
	`approved` integer DEFAULT false NOT NULL
);
