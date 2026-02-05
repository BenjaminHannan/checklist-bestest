import { useEffect, useMemo, useRef, useState } from "react";

type Recurrence = "none" | "daily" | "weekly";

type Task = {
  id: string;
  title: string;
  due_date: string;
  recurrence: Recurrence;
  recurrence_detail: string;
  category: string;
  completed: boolean;
  completed_at: string;
  created_at: string;
  updated_at: string;
  archived: boolean;
  rowIndex: number;
};

type HeatmapCell = {
  date: string;
  dueCount: number;
  completedCount: number;
  status: "none" | "green" | "yellow" | "red";
};

const TASK_HEADERS = [
  "id",
  "title",
  "due_date",
  "recurrence",
  "recurrence_detail",
  "category",
  "completed",
  "completed_at",
  "created_at",
  "updated_at",
  "archived",
];

const SETTINGS_HEADERS = ["key", "value"];

const DEFAULT_SETTINGS = {
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  heatmap_window_days: "120",
  upcoming_window_days: "7",
};

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;
const SCOPES = [
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/drive.file",
].join(" ");

type ViewKey = "today" | "upcoming" | "all" | "completed";

const viewLabels: Record<ViewKey, string> = {
  today: "Today",
  upcoming: "Upcoming",
  all: "All",
  completed: "Completed",
};

const toIsoDate = (date: Date) => date.toISOString().slice(0, 10);

const parseBoolean = (value: string | undefined) =>
  value?.toUpperCase() === "TRUE";

const formatDateLabel = (date: string) =>
  new Date(`${date}T00:00:00`).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });

const addDays = (date: Date, days: number) => {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
};

const getNextDueDate = (task: Task) => {
  const base = new Date(`${task.due_date}T00:00:00`);
  if (task.recurrence === "daily") {
    return toIsoDate(addDays(base, 1));
  }
  if (task.recurrence === "weekly") {
    return toIsoDate(addDays(base, 7));
  }
  return task.due_date;
};

const toSheetBoolean = (value: boolean) => (value ? "TRUE" : "FALSE");

const buildRow = (task: Omit<Task, "rowIndex">) => [
  task.id,
  task.title,
  task.due_date,
  task.recurrence,
  task.recurrence_detail,
  task.category,
  toSheetBoolean(task.completed),
  task.completed_at,
  task.created_at,
  task.updated_at,
  toSheetBoolean(task.archived),
];

const ensureScript = (src: string) =>
  new Promise<void>((resolve, reject) => {
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing) {
      resolve();
      return;
    }
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Failed to load script"));
    document.body.appendChild(script);
  });

const getLocalStorage = (key: string, fallback: string) => {
  const value = window.localStorage.getItem(key);
  return value ?? fallback;
};

const setLocalStorage = (key: string, value: string) => {
  window.localStorage.setItem(key, value);
};

export default function App() {
  const tokenClientRef = useRef<google.accounts.oauth2.TokenClient | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [spreadsheetId, setSpreadsheetId] = useState(() =>
    getLocalStorage("greenday.spreadsheetId", ""),
  );
  const [tasks, setTasks] = useState<Task[]>([]);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [view, setView] = useState<ViewKey>("today");
  const [status, setStatus] = useState<string>("Sign in to get started.");
  const [newTitle, setNewTitle] = useState("");
  const [newDueDate, setNewDueDate] = useState(toIsoDate(new Date()));
  const [newRecurrence, setNewRecurrence] = useState<Recurrence>("none");
  const [newCategory, setNewCategory] = useState("");

  useEffect(() => {
    if (!CLIENT_ID) {
      setStatus("Missing VITE_GOOGLE_CLIENT_ID in your environment.");
      return;
    }

    ensureScript("https://accounts.google.com/gsi/client")
      .then(() => {
        tokenClientRef.current = window.google.accounts.oauth2.initTokenClient({
          client_id: CLIENT_ID,
          scope: SCOPES,
          callback: (tokenResponse) => {
            if (tokenResponse.access_token) {
              setAccessToken(tokenResponse.access_token);
              setStatus("Connected. Ready to load your sheet.");
            }
          },
        });
        setIsReady(true);
      })
      .catch(() => {
        setStatus("Failed to load Google Identity Services.");
      });
  }, []);

  useEffect(() => {
    if (accessToken && spreadsheetId) {
      void loadAllData(spreadsheetId, accessToken);
    }
  }, [accessToken, spreadsheetId]);

  const headersToRange = (headerCount: number) =>
    `A1:${String.fromCharCode(64 + headerCount)}1`;

  const fetchJson = async (url: string, options?: RequestInit) => {
    if (!accessToken) {
      throw new Error("Missing access token");
    }
    const response = await fetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        ...options?.headers,
      },
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(text || response.statusText);
    }
    return response.json();
  };

  const ensureSheet = async (
    spreadsheetIdValue: string,
    title: string,
    headers: string[],
  ) => {
    const metadata = await fetchJson(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetIdValue}?fields=sheets.properties(title)`
    );

    const existingTitles = new Set(
      metadata.sheets.map((sheet: { properties: { title: string } }) =>
        sheet.properties.title.toLowerCase(),
      ),
    );

    if (!existingTitles.has(title.toLowerCase())) {
      await fetchJson(
        `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetIdValue}:batchUpdate`,
        {
          method: "POST",
          body: JSON.stringify({
            requests: [
              {
                addSheet: {
                  properties: {
                    title,
                  },
                },
              },
            ],
          }),
        },
      );
    }

    await fetchJson(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetIdValue}/values/${title}!${headersToRange(
        headers.length,
      )}?valueInputOption=RAW`,
      {
        method: "PUT",
        body: JSON.stringify({
          values: [headers],
        }),
      },
    );
  };

  const ensureSettingsDefaults = async (
    spreadsheetIdValue: string,
    settingsValue: typeof DEFAULT_SETTINGS,
  ) => {
    const rows = Object.entries(settingsValue).map(([key, value]) => [key, value]);
    await fetchJson(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetIdValue}/values/Settings!A2:B${
        rows.length + 1
      }?valueInputOption=RAW`,
      {
        method: "PUT",
        body: JSON.stringify({
          values: rows,
        }),
      },
    );
  };

  const createTemplate = async () => {
    if (!accessToken) {
      setStatus("Sign in first to create a spreadsheet.");
      return;
    }
    const response = await fetchJson(
      "https://sheets.googleapis.com/v4/spreadsheets",
      {
        method: "POST",
        body: JSON.stringify({
          properties: {
            title: "GreenDay Checklist",
          },
          sheets: [
            {
              properties: { title: "Tasks" },
              data: [
                {
                  rowData: [
                    {
                      values: TASK_HEADERS.map((header) => ({
                        userEnteredValue: { stringValue: header },
                      })),
                    },
                  ],
                },
              ],
            },
            {
              properties: { title: "Settings" },
              data: [
                {
                  rowData: [
                    {
                      values: SETTINGS_HEADERS.map((header) => ({
                        userEnteredValue: { stringValue: header },
                      })),
                    },
                  ],
                },
              ],
            },
          ],
        }),
      },
    );

    const newId = response.spreadsheetId as string;
    setSpreadsheetId(newId);
    setLocalStorage("greenday.spreadsheetId", newId);
    await ensureSettingsDefaults(newId, DEFAULT_SETTINGS);
    setStatus("Template created. Ready to load.");
  };

  const loadAllData = async (sheetId: string, token: string) => {
    if (!token) {
      return;
    }
    try {
      setStatus("Verifying sheet structure...");
      await ensureSheet(sheetId, "Tasks", TASK_HEADERS);
      await ensureSheet(sheetId, "Settings", SETTINGS_HEADERS);
      setStatus("Loading tasks...");
      const taskValues = await fetchJson(
        `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/Tasks!A:K`,
      );
      const rows: string[][] = taskValues.values ?? [];
      const [, ...dataRows] = rows;
      const parsed = dataRows
        .map((row, index) => ({
          id: row[0] ?? crypto.randomUUID(),
          title: row[1] ?? "",
          due_date: row[2] ?? toIsoDate(new Date()),
          recurrence: (row[3] as Recurrence) ?? "none",
          recurrence_detail: row[4] ?? "",
          category: row[5] ?? "",
          completed: parseBoolean(row[6]),
          completed_at: row[7] ?? "",
          created_at: row[8] ?? "",
          updated_at: row[9] ?? "",
          archived: parseBoolean(row[10]),
          rowIndex: index + 2,
        }))
        .filter((task) => task.title.trim().length > 0);

      setTasks(parsed);

      const settingsValues = await fetchJson(
        `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/Settings!A:B`,
      );
      const settingRows: string[][] = settingsValues.values ?? [];
      const [, ...settingData] = settingRows;
      if (settingData.length === 0) {
        await ensureSettingsDefaults(sheetId, DEFAULT_SETTINGS);
        setSettings(DEFAULT_SETTINGS);
      } else {
        const parsedSettings = { ...DEFAULT_SETTINGS };
        settingData.forEach(([key, value]) => {
          if (key && value) {
            parsedSettings[key as keyof typeof DEFAULT_SETTINGS] = value;
          }
        });
        setSettings(parsedSettings);
      }
      setStatus("Loaded. Make the day green!");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      setStatus(`Failed to load sheet: ${message}`);
    }
  };

  const upsertTaskRow = async (task: Task) => {
    if (!accessToken) {
      return;
    }
    const updatedTask = { ...task, updated_at: new Date().toISOString() };
    await fetchJson(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/Tasks!A${task.rowIndex}:K${task.rowIndex}?valueInputOption=RAW`,
      {
        method: "PUT",
        body: JSON.stringify({
          values: [buildRow(updatedTask)],
        }),
      },
    );
  };

  const appendTaskRow = async (task: Omit<Task, "rowIndex">) => {
    if (!accessToken) {
      return null;
    }
    const response = await fetchJson(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/Tasks!A:K:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
      {
        method: "POST",
        body: JSON.stringify({
          values: [buildRow(task)],
        }),
      },
    );
    const updatedRange = response.updates?.updatedRange as string | undefined;
    if (updatedRange) {
      const match = updatedRange.match(/!A(\d+):/);
      if (match) {
        return Number(match[1]);
      }
    }
    return null;
  };

  const handleAddTask = async () => {
    if (!newTitle.trim()) {
      setStatus("Add a title first.");
      return;
    }
    if (!accessToken || !spreadsheetId) {
      setStatus("Connect a sheet first.");
      return;
    }
    const now = new Date().toISOString();
    const newTask: Omit<Task, "rowIndex"> = {
      id: crypto.randomUUID(),
      title: newTitle.trim(),
      due_date: newDueDate,
      recurrence: newRecurrence,
      recurrence_detail: newRecurrence === "weekly" ? new Date(newDueDate).getDay().toString() : "",
      category: newCategory.trim(),
      completed: false,
      completed_at: "",
      created_at: now,
      updated_at: now,
      archived: false,
    };
    try {
      const rowIndex = await appendTaskRow(newTask);
      setTasks((prev) => [
        ...prev,
        {
          ...newTask,
          rowIndex: rowIndex ?? prev.length + 2,
        },
      ]);
      setNewTitle("");
      setStatus("Task added.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      setStatus(`Failed to add task: ${message}`);
    }
  };

  const handleToggleComplete = async (task: Task) => {
    if (!accessToken) {
      return;
    }
    const isCompleting = !task.completed;
    const updated: Task = {
      ...task,
      completed: isCompleting,
      completed_at: isCompleting ? new Date().toISOString() : "",
    };
    try {
      await upsertTaskRow(updated);
      setTasks((prev) => prev.map((item) => (item.id === task.id ? updated : item)));
      if (isCompleting && task.recurrence !== "none") {
        const now = new Date().toISOString();
        const nextDue = getNextDueDate(task);
        const cloned: Omit<Task, "rowIndex"> = {
          id: crypto.randomUUID(),
          title: task.title,
          due_date: nextDue,
          recurrence: task.recurrence,
          recurrence_detail: task.recurrence_detail,
          category: task.category,
          completed: false,
          completed_at: "",
          created_at: now,
          updated_at: now,
          archived: false,
        };
        const rowIndex = await appendTaskRow(cloned);
        setTasks((prev) => [
          ...prev,
          {
            ...cloned,
            rowIndex: rowIndex ?? prev.length + 2,
          },
        ]);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      setStatus(`Failed to update task: ${message}`);
    }
  };

  const handleArchive = async (task: Task) => {
    const updated = { ...task, archived: true };
    try {
      await upsertTaskRow(updated);
      setTasks((prev) => prev.map((item) => (item.id === task.id ? updated : item)));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      setStatus(`Failed to archive task: ${message}`);
    }
  };

  const handleUpdateTask = async (task: Task, updates: Partial<Task>) => {
    const updated = { ...task, ...updates };
    try {
      await upsertTaskRow(updated);
      setTasks((prev) => prev.map((item) => (item.id === task.id ? updated : item)));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      setStatus(`Failed to edit task: ${message}`);
    }
  };

  const filteredTasks = useMemo(() => {
    const today = toIsoDate(new Date());
    const todayDate = new Date(`${today}T00:00:00`);
    const upcomingWindow = Number(settings.upcoming_window_days) || 7;
    const upcomingEnd = addDays(todayDate, upcomingWindow);

    return tasks.filter((task) => {
      if (task.archived) {
        return false;
      }
      if (view === "completed") {
        return task.completed;
      }
      if (view === "all") {
        return true;
      }
      const due = new Date(`${task.due_date}T00:00:00`);
      const isOverdue = !task.completed && due < todayDate;
      if (view === "today") {
        return task.due_date === today || isOverdue;
      }
      if (view === "upcoming") {
        return due >= todayDate && due <= upcomingEnd;
      }
      return true;
    });
  }, [tasks, view, settings]);

  const heatmap = useMemo(() => {
    const windowDays = Number(settings.heatmap_window_days) || 120;
    const today = new Date();
    const start = addDays(today, -windowDays + 1);

    const dueMap = new Map<string, Task[]>();
    tasks
      .filter((task) => !task.archived)
      .forEach((task) => {
        const list = dueMap.get(task.due_date) ?? [];
        list.push(task);
        dueMap.set(task.due_date, list);
      });

    const cells: HeatmapCell[] = [];
    for (let i = 0; i < windowDays; i += 1) {
      const date = addDays(start, i);
      const key = toIsoDate(date);
      const dueTasks = dueMap.get(key) ?? [];
      const dueCount = dueTasks.length;
      const completedCount = dueTasks.filter((task) => task.completed).length;
      let status: HeatmapCell["status"] = "none";
      if (dueCount > 0) {
        if (completedCount === dueCount) {
          status = "green";
        } else if (completedCount === 0) {
          status = "red";
        } else {
          status = "yellow";
        }
      }
      cells.push({
        date: key,
        dueCount,
        completedCount,
        status,
      });
    }
    return cells;
  }, [tasks, settings]);

  const streak = useMemo(() => {
    const today = toIsoDate(new Date());
    const index = heatmap.findIndex((cell) => cell.date === today);
    if (index === -1) {
      return 0;
    }
    let count = 0;
    for (let i = index; i >= 0; i -= 1) {
      if (heatmap[i].status === "green") {
        count += 1;
      } else {
        break;
      }
    }
    return count;
  }, [heatmap]);

  const todayStatus = useMemo(() => {
    const today = toIsoDate(new Date());
    return heatmap.find((cell) => cell.date === today);
  }, [heatmap]);

  return (
    <div className="app">
      <header className="topbar">
        <div>
          <h1>GreenDay Checklist</h1>
          <p className="status">{status}</p>
        </div>
        <div className="auth">
          <button
            type="button"
            className="primary"
            disabled={!isReady}
            onClick={() => tokenClientRef.current?.requestAccessToken({ prompt: "consent" })}
          >
            Sign in with Google
          </button>
          <button type="button" onClick={createTemplate} disabled={!accessToken}>
            Create template sheet
          </button>
        </div>
      </header>

      <section className="setup">
        <label>
          Spreadsheet ID
          <input
            type="text"
            value={spreadsheetId}
            onChange={(event) => setSpreadsheetId(event.target.value)}
            placeholder="Paste your Google Sheet ID"
          />
        </label>
        <button
          type="button"
          onClick={() => {
            if (!spreadsheetId) {
              setStatus("Paste a spreadsheet ID first.");
              return;
            }
            setLocalStorage("greenday.spreadsheetId", spreadsheetId);
            if (accessToken) {
              void loadAllData(spreadsheetId, accessToken);
            }
          }}
          disabled={!accessToken || !spreadsheetId}
        >
          Connect sheet
        </button>
      </section>

      <section className="quick-add">
        <input
          type="text"
          value={newTitle}
          onChange={(event) => setNewTitle(event.target.value)}
          placeholder="Quick add task title"
        />
        <input
          type="date"
          value={newDueDate}
          onChange={(event) => setNewDueDate(event.target.value)}
        />
        <select
          value={newRecurrence}
          onChange={(event) => setNewRecurrence(event.target.value as Recurrence)}
        >
          <option value="none">No recurrence</option>
          <option value="daily">Daily</option>
          <option value="weekly">Weekly</option>
        </select>
        <input
          type="text"
          value={newCategory}
          onChange={(event) => setNewCategory(event.target.value)}
          placeholder="Category"
        />
        <button type="button" className="primary" onClick={handleAddTask}>
          Add task
        </button>
      </section>

      <div className="layout">
        <aside className="sidebar">
          <nav>
            {Object.entries(viewLabels).map(([key, label]) => (
              <button
                key={key}
                type="button"
                className={view === key ? "active" : ""}
                onClick={() => setView(key as ViewKey)}
              >
                {label}
              </button>
            ))}
          </nav>
          <div className="streak">
            <span>Green streak</span>
            <strong>{streak} day{streak === 1 ? "" : "s"}</strong>
          </div>
          <div className="today-status">
            <span>Today</span>
            <strong>{todayStatus?.completedCount ?? 0}/{todayStatus?.dueCount ?? 0}</strong>
          </div>
        </aside>

        <main className="main">
          <div className="list-header">
            <h2>{viewLabels[view]}</h2>
          </div>
          <div className="task-list">
            {filteredTasks.length === 0 ? (
              <p className="empty">No tasks to show.</p>
            ) : (
              filteredTasks.map((task) => {
                const dueDate = new Date(`${task.due_date}T00:00:00`);
                const today = new Date();
                today.setHours(0, 0, 0, 0);
                const isOverdue = !task.completed && dueDate < today;
                const isToday = task.due_date === toIsoDate(new Date());
                return (
                  <div key={task.id} className={`task ${task.completed ? "done" : ""}`}>
                    <label>
                      <input
                        type="checkbox"
                        checked={task.completed}
                        onChange={() => handleToggleComplete(task)}
                      />
                      <span className="title">{task.title}</span>
                    </label>
                    <div className="meta">
                      <span className={`badge ${isOverdue ? "overdue" : isToday ? "today" : ""}`}>
                        {isOverdue ? "Overdue" : formatDateLabel(task.due_date)}
                      </span>
                      {task.recurrence !== "none" && (
                        <span className="badge recurrence">{task.recurrence}</span>
                      )}
                      {task.category && <span className="badge category">{task.category}</span>}
                      <button
                        type="button"
                        className="link"
                        onClick={() =>
                          handleUpdateTask(task, {
                            due_date: prompt("New due date (YYYY-MM-DD)", task.due_date) ?? task.due_date,
                          })
                        }
                      >
                        Edit
                      </button>
                      <button type="button" className="link" onClick={() => handleArchive(task)}>
                        Archive
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </main>

        <aside className="heatmap-panel">
          <h3>Completion Heatmap</h3>
          <div className="heatmap">
            {heatmap.map((cell) => (
              <div
                key={cell.date}
                className={`heatmap-cell ${cell.status}`}
                title={`${cell.date}: ${cell.completedCount}/${cell.dueCount} completed`}
              />
            ))}
          </div>
          <div className="legend">
            <span className="heatmap-cell none" /> None
            <span className="heatmap-cell red" /> 0%
            <span className="heatmap-cell yellow" /> Partial
            <span className="heatmap-cell green" /> 100%
          </div>
        </aside>
      </div>
    </div>
  );
}
