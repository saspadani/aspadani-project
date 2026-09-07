-- Migration: Focus list (Fokus Hari Ini)
-- 1) columns.role = peran eksplisit kolom: backlog | doing | waiting | done (NULL = belum ditetapkan)
-- 2) tasks.blocked_since = kapan task mulai diblokir (untuk hitung umur blokir / aging)

ALTER TABLE columns ADD COLUMN role TEXT;
--> statement-breakpoint
ALTER TABLE tasks ADD COLUMN blocked_since TEXT;
