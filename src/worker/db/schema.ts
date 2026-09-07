import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  color: text("color").notNull().default("#6366f1"),
  sort: integer("sort").notNull().default(0),
  archived: integer("archived").notNull().default(0),
  createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
  updatedAt: text("updated_at").notNull().default(sql`(datetime('now'))`),
});

export const columns = sqliteTable(
  "columns",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    sort: integer("sort").notNull().default(0),
    isDone: integer("is_done").notNull().default(0),
    isBlocked: integer("is_blocked").notNull().default(0),
    wipLimit: integer("wip_limit").notNull().default(-1),
    /** Peran eksplisit: backlog | doing | waiting | done. NULL = belum ditetapkan. */
    role: text("role"),
  },
  (t) => [index("idx_columns_project").on(t.projectId, t.sort)],
);

export const tasks = sqliteTable(
  "tasks",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    columnId: text("column_id")
      .notNull()
      .references(() => columns.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    notes: text("notes").notNull().default(""),
    priority: text("priority").notNull().default("none"),
    dueDate: text("due_date"),
    isBlocked: integer("is_blocked").notNull().default(0),
    blockedReason: text("blocked_reason"),
    /** ISO saat task mulai diblokir; NULL saat tidak blocked. Untuk aging. */
    blockedSince: text("blocked_since"),
    sort: integer("sort").notNull().default(0),
    createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
    updatedAt: text("updated_at").notNull().default(sql`(datetime('now'))`),
  },
  (t) => [
    index("idx_tasks_column").on(t.columnId, t.sort),
    index("idx_tasks_project").on(t.projectId),
  ],
);

export const subtasks = sqliteTable(
  "subtasks",
  {
    id: text("id").primaryKey(),
    taskId: text("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    done: integer("done").notNull().default(0),
    sort: integer("sort").notNull().default(0),
    createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
  },
  (t) => [index("idx_subtasks_task").on(t.taskId, t.sort)],
);

export const recurringTasks = sqliteTable(
  "recurring_tasks",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    columnId: text("column_id")
      .notNull()
      .references(() => columns.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    notes: text("notes").notNull().default(""),
    priority: text("priority").notNull().default("none"),
    freqType: text("freq_type").notNull().default("daily"),
    freqInterval: integer("freq_interval").notNull().default(1),
    dayOfWeek: integer("day_of_week"),
    dayOfMonth: integer("day_of_month"),
    lastGeneratedDate: text("last_generated_date"),
    active: integer("active").notNull().default(1),
    createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
    updatedAt: text("updated_at").notNull().default(sql`(datetime('now'))`),
  },
  (t) => [index("idx_recurring_project").on(t.projectId)],
);
