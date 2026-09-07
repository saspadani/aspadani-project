export type Project = {
  id: string;
  name: string;
  color: string;
  sort: number;
  createdAt: string;
  updatedAt: string;
  activeTaskCount?: number;
};

export type Column = {
  id: string;
  projectId: string;
  name: string;
  sort: number;
  isDone: number;
  isBlocked: number;
  wipLimit: number;
  role?: "backlog" | "doing" | "waiting" | "done" | null;
};

/** Representasi ringan kolom untuk quick-add di dashboard. */
export type ColumnOption = {
  id: string;
  name: string;
  isDone: number;
};

export type SearchResult = {
  taskId: string;
  taskTitle: string;
  taskNotes: string;
  taskPriority: "none" | "low" | "med" | "high";
  taskDueDate: string | null;
  projectId: string;
  projectName: string;
  projectColor: string;
  colName: string;
};

export type Task = {
  id: string;
  projectId: string;
  columnId: string;
  title: string;
  notes: string;
  priority: "none" | "low" | "med" | "high";
  dueDate: string | null;
  isBlocked: number;
  blockedReason: string | null;
  blockedSince?: string | null;
  sort: number;
};

/** Item daftar "Fokus Hari Ini" (lintas proyek). */
export type FocusItem = {
  id: string;
  title: string;
  priority: "none" | "low" | "med" | "high";
  dueDate: string | null;
  blockedReason: string | null;
  blockedSince: string | null;
  projectId: string;
  projectName: string;
};

export type Subtask = {
  id: string;
  taskId: string;
  title: string;
  done: number;
  sort: number;
  createdAt: string;
};

export type RecurringTask = {
  id: string;
  projectId: string;
  columnId: string;
  title: string;
  notes: string;
  priority: "none" | "low" | "med" | "high";
  freqType: "daily" | "weekly" | "monthly";
  freqInterval: number;
  dayOfWeek: number | null;
  dayOfMonth: number | null;
  lastGeneratedDate: string | null;
  active: number;
  createdAt: string;
  updatedAt: string;
};
