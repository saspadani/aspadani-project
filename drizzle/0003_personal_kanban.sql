-- Migration: Add Personal Kanban high-priority features
-- 1) is_blocked column on columns table (marks a column as "blocked")
-- 2) wipLimit on columns table (WIP limit per column, -1 = no limit)
-- 3) is_blocked on tasks table (marks a task as blocked)
-- 4) blockedReason on tasks table (why the task is blocked)
-- 5) Add "Blocked" column to existing projects (optional, done via UI)

ALTER TABLE `columns` ADD COLUMN `is_blocked` integer NOT NULL DEFAULT 0;
ALTER TABLE `columns` ADD COLUMN `wip_limit` integer NOT NULL DEFAULT -1;
ALTER TABLE `tasks` ADD COLUMN `is_blocked` integer NOT NULL DEFAULT 0;
ALTER TABLE `tasks` ADD COLUMN `blocked_reason` text;

CREATE INDEX `idx_tasks_blocked` ON `tasks` (`is_blocked`) WHERE `is_blocked` = 1;
