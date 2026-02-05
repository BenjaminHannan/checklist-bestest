# GreenDay Checklist

A desktop-focused checklist web app for a single high school student. Tasks and habits live in Google Sheets as the only source of truth, with Google OAuth for sign-in.

## Features
- Google sign-in with Google Sheets API access.
- Create/connect to a spreadsheet and auto-create required tabs/headers.
- Today, Upcoming, All, Completed views with overdue highlighting.
- Recurring task handling (daily/weekly) that clones the next occurrence on completion.
- Heatmap calendar that turns green only when all tasks due that day are completed.

## Setup

### 1) Create a Google Cloud project
1. Go to [Google Cloud Console](https://console.cloud.google.com/).
2. Create a new project.
3. Enable **Google Sheets API**.
4. Configure OAuth consent screen (External is fine for testing).
5. Create OAuth client credentials (Web application).
6. Add authorized origins (for local dev):
   - `http://localhost:4173`

### 2) Configure environment
Create a `.env.local` file in the repo root:

```
VITE_GOOGLE_CLIENT_ID=YOUR_CLIENT_ID.apps.googleusercontent.com
```

### 3) Install dependencies

```
npm install
```

### 4) Run the app

```
npm run dev
```

Open `http://localhost:4173`.

## Using the app
1. Click **Sign in with Google**.
2. Either:
   - Paste an existing Spreadsheet ID, or
   - Click **Create template sheet** to auto-create a spreadsheet in your Drive.
3. Click **Connect sheet** to load tasks.

The app will create/verify the required sheets and headers:
- **Tasks** tab with columns:
  - id, title, due_date, recurrence, recurrence_detail, category, completed, completed_at, created_at, updated_at, archived
- **Settings** tab with columns:
  - key, value

You can edit the **Settings** sheet to update:
- `timezone`
- `heatmap_window_days`
- `upcoming_window_days`

## Data model
The app uses the Google Sheets API v4 to read/write rows directly.

### Tasks
Each row represents a task instance. Recurring tasks are cloned when completed so history stays intact.

### Settings
Key/value configuration read on load.

## Notes
- This MVP is desktop-only and optimized for quick daily use.
- All data persists directly in Google Sheets; no other database is used.
