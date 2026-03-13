CREATE TABLE `token_usage` (
	`id` text PRIMARY KEY NOT NULL,
	`sub_chat_id` text NOT NULL,
	`chat_id` text NOT NULL,
	`project_id` text,
	`model_id` text NOT NULL,
	`model_provider` text,
	`model_profile_id` text,
	`model_profile_name` text,
	`input_tokens` integer DEFAULT 0 NOT NULL,
	`output_tokens` integer DEFAULT 0 NOT NULL,
	`cache_read_tokens` integer DEFAULT 0,
	`cache_write_tokens` integer DEFAULT 0,
	`total_tokens` integer DEFAULT 0 NOT NULL,
	`cost_usd` integer,
	`duration_ms` integer,
	`created_at` integer,
	FOREIGN KEY (`sub_chat_id`) REFERENCES `sub_chats`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`chat_id`) REFERENCES `chats`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `token_usage_subchat_idx` ON `token_usage` (`sub_chat_id`);--> statement-breakpoint
CREATE INDEX `token_usage_chat_idx` ON `token_usage` (`chat_id`);--> statement-breakpoint
CREATE INDEX `token_usage_project_idx` ON `token_usage` (`project_id`);--> statement-breakpoint
CREATE INDEX `token_usage_model_idx` ON `token_usage` (`model_id`);--> statement-breakpoint
CREATE INDEX `token_usage_created_idx` ON `token_usage` (`created_at`);--> statement-breakpoint
CREATE INDEX `token_usage_provider_idx` ON `token_usage` (`model_provider`);