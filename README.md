# CaliB Business Analytics Dashboard

Full-stack analytics dashboard for the Software Developer Intern technical assessment. It turns the provided 300,000-row restaurant order CSV into a PostgreSQL-backed dashboard with KPIs, filters, charts, export, and documented technical decisions.

## What Was Built

- React frontend built with Vite.
- Node.js backend built with Express.
- Python ETL script to load `data.csv` into PostgreSQL.
- PostgreSQL schema with generated revenue column and indexes for dashboard filters.
- Local CSV fallback for development when PostgreSQL is unavailable.
- Recharts visualizations:
  - Monthly revenue trend line chart.
  - Revenue by category bar chart.
  - Order type pie chart.
  - Top items horizontal bar chart.
  - Hourly demand line chart.
  - Order value distribution box plot by outlet.
  - Category seasonality stacked area chart.
  - Order total histogram.
  - Day/hour peak demand heatmap.
  - Price vs quantity scatter plot.
- Dashboard filters:
  - Date range.
  - Outlet.
  - Menu category.
  - Order type.
- Summary KPIs:
  - Revenue.
  - Orders.
  - Average order value.
  - Items sold.
  - Line records.
- CSV export for the filtered top items report.

## Project Structure

```text
CaliB/
  client/                 React/Vite dashboard
  server/                 Express API
  scripts/load_csv.py     Python ETL loader
  db/schema.sql           PostgreSQL table and indexes
  data.csv                Assessment dataset
  docker-compose.yml      Local PostgreSQL service
  render.yaml             Render deployment blueprint
```

## Requirements

- Node.js 20 or newer. This machine has Node 24.
- npm 10 or newer.
- Python 3.10 or newer.
- PostgreSQL `psql` client.
- Docker Desktop or Docker Engine for local PostgreSQL.

## Setup

Copy the environment example:

```bash
cp .env.example .env
```

Install JavaScript dependencies:

```bash
npm install
```

No Python package install is required. The ETL uses the Python standard library and the PostgreSQL `psql` CLI.

Start PostgreSQL:

```bash
docker compose up -d postgres
```

Load the CSV into PostgreSQL:

```bash
python3 scripts/load_csv.py --reset
```

Start the app in development mode:

```bash
npm run dev
```

Open the dashboard at the client URL printed by Vite. By default this is:

```text
http://localhost:5173
```

The API runs at the port printed by the server. By default this is:

```text
http://localhost:4000/api
```

If either default port is already in use, the dev script automatically picks the next available port and keeps the Vite API proxy pointed at the matching backend.

If PostgreSQL is unavailable locally, the API falls back to `data.csv` so the dashboard can still run. To use the PostgreSQL path, confirm PostgreSQL is running and the `.env` `DATABASE_URL` matches the actual database credentials. Then reload the source data:

```bash
python3 scripts/load_csv.py --reset
```

## Useful Commands

Build the React app:

```bash
npm run build
```

Run the production server after building:

```bash
npm start
```

Lint and syntax-check the project:

```bash
npm run lint
```

Reset and reload data:

```bash
python3 scripts/load_csv.py --reset
```

Append data without truncating existing rows:

```bash
python3 scripts/load_csv.py
```

## API Endpoints

- `GET /api/health` checks database connectivity and row count.
- `GET /api/filters` returns available filter values and date bounds.
- `GET /api/dashboard` returns KPIs and chart datasets.
- `GET /api/export/top-items.csv` downloads filtered top item revenue data.

Supported query parameters:

- `from=YYYY-MM-DD`
- `to=YYYY-MM-DD`
- `outlet=Koramangala`
- `group=Burgers`
- `orderType=Dine-In`

Example:

```bash
curl "http://localhost:4000/api/dashboard?from=2025-01-01&to=2026-12-31&group=Burgers"
```

## Architecture Decisions

The dataset has 300,000 line-item rows, so the app does not load the CSV directly in the browser. The preferred path is to import the file once into PostgreSQL with the Python ETL, and let the Node API serve aggregated results. This keeps the frontend lightweight and lets PostgreSQL handle filtering, grouping, and revenue calculations.

For local development resilience, the API also includes a CSV fallback. If PostgreSQL is not reachable, authentication fails, or the schema is missing, the server loads `data.csv` once into memory and serves the same dashboard endpoints from that cached dataset. This keeps the application demoable even before local database credentials are fixed.

Revenue is stored as a generated column:

```sql
line_revenue NUMERIC(12, 2) GENERATED ALWAYS AS (price * quantity) STORED
```

That keeps every query consistent and avoids duplicating revenue logic across Python, Node, and React.

The API uses parameterized SQL and an in-memory 60-second cache for repeated dashboard requests. PostgreSQL indexes support date filtering, bill aggregation, outlet/category/order-type filters, and item lookups.

The frontend fetches aggregated datasets only. It never receives the full 300,000 rows, which improves page load time and keeps charts responsive.

## Data Assumptions

The assessment text says `Order_Datetime` is `DD-MM-YYYY HH:MM:SS`, but the actual CSV values use slash-separated month/day/year strings such as `6/11/2026 19:14`. The ETL parses the real file as:

```text
M/D/YYYY HH:MM
M/D/YYYY HH:MM:SS
```

The CSV contains one row per line item. `BillNo` is treated as the order identifier when calculating order counts and average order value.

## Performance Notes

- ETL parses the source CSV with Python, writes a normalized temporary CSV, and uses PostgreSQL `COPY` for fast bulk loading.
- `ANALYZE order_line_items` runs after loading so PostgreSQL has fresh query statistics.
- Dashboard queries aggregate in the database.
- API responses are cached for 60 seconds per filter combination.
- The React app renders summary datasets rather than raw rows.

## Deployment

The repository includes `render.yaml` for a Render deployment with a managed PostgreSQL database. The Express server serves the built React app from `client/dist`, so one web service can host the full application.

Suggested Render flow:

1. Push this folder to a public GitHub repository.
2. Create a new Render Blueprint from that repository.
3. Let Render create the web service and PostgreSQL database from `render.yaml`.
4. After the database is available, run the ETL once against the Render `DATABASE_URL`:

```bash
DATABASE_URL="postgres://..." python3 scripts/load_csv.py --reset
```

Live deployment:

```text
Deployed URL: https://calib-dashboard.onrender.com
GitHub repository: https://github.com/akshatsharma1979/CaliB.git
```

The Render deployment is configured to use the bundled CSV fallback when the managed PostgreSQL database has not been loaded yet, so the live dashboard remains functional while still supporting the PostgreSQL ETL path.

## Submission Checklist

- Public GitHub repository link.
- Live deployed application URL.
- README with setup, architecture, trade-offs, assumptions, and deployment notes.
- Loaded PostgreSQL database containing the provided `data.csv`.
