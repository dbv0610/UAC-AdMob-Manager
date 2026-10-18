ALTER TABLE `creatives` ADD `source` text DEFAULT 'file' NOT NULL;--> statement-breakpoint
ALTER TABLE `creatives` ADD `app_id` text;--> statement-breakpoint
ALTER TABLE `creatives` ADD `name` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `creatives` ADD `size_bytes` integer;--> statement-breakpoint
ALTER TABLE `creatives` ADD `privacy` text;--> statement-breakpoint
ALTER TABLE `creatives` ADD `upload_session` text;--> statement-breakpoint
ALTER TABLE `creatives` ADD `error` text;--> statement-breakpoint
ALTER TABLE `creatives` ADD `updated_at` text;