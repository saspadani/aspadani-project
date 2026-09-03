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
  sort: number;
};

export type Subtask = {
  id: string;
  taskId: string;
  title: string;
  done: number;
  sort: number;
  createdAt: string;
};
