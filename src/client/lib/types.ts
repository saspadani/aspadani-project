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
