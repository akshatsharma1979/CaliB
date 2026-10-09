import { useEffect, useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis
} from "recharts";
import { Download, RefreshCcw } from "lucide-react";
import { exportUrl, getJson } from "./api.js";

const COLORS = ["#2563eb", "#16a34a", "#f97316", "#dc2626", "#7c3aed", "#0891b2", "#ca8a04"];

const initialFilters = {
  from: "",
  to: "",
  outlet: "",
  group: "",
  orderType: ""
};

function formatCurrency(value) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0
  }).format(value ?? 0);
}

function formatNumber(value) {
  return new Intl.NumberFormat("en-IN").format(value ?? 0);
}

function KpiCard({ label, value, accent }) {
  return (
    <article className="kpi-card" style={{ "--accent": accent }}>
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

function SelectFilter({ label, name, value, options, onChange }) {
  return (
    <label className="field">
      <span>{label}</span>
      <select name={name} value={value} onChange={onChange}>
        <option value="">All</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}

function EmptyState() {
  return <div className="empty-state">No matching records</div>;
}

function ScatterTooltip({ active, payload }) {
  if (!active || !payload?.length) {
    return null;
  }

  const row = payload[0].payload;
  return (
    <div className="chart-tooltip">
      <strong>{row.item}</strong>
      <span>{row.group}</span>
      <span>Avg. price: {formatCurrency(row.avgPrice)}</span>
      <span>Quantity: {formatNumber(row.quantity)}</span>
      <span>Revenue: {formatCurrency(row.revenue)}</span>
    </div>
  );
}

function Heatmap({ data }) {
  const maxOrders = Math.max(...data.map((cell) => cell.orders), 1);
  const hours = [...new Set(data.map((cell) => cell.hour))];
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const cellMap = new Map(data.map((cell) => [`${cell.day}:${cell.hour}`, cell]));

  return (
    <div className="heatmap" style={{ "--heatmap-columns": hours.length }}>
      <div className="heatmap-corner" />
      {hours.map((hour) => (
        <div className="heatmap-hour" key={hour}>
          {hour.replace(":00", "")}
        </div>
      ))}

      {days.map((day) => (
        <FragmentRow key={day} day={day} hours={hours} cellMap={cellMap} maxOrders={maxOrders} />
      ))}
    </div>
  );
}

function FragmentRow({ day, hours, cellMap, maxOrders }) {
  return (
    <>
      <div className="heatmap-day">{day}</div>
      {hours.map((hour) => {
        const cell = cellMap.get(`${day}:${hour}`) ?? { orders: 0, revenue: 0 };
        const intensity = cell.orders / maxOrders;
        return (
          <div
            className="heatmap-cell"
            key={`${day}-${hour}`}
            style={{ "--intensity": intensity }}
            title={`${day} ${hour}: ${formatNumber(cell.orders)} orders, ${formatCurrency(cell.revenue)}`}
          >
            {cell.orders ? formatNumber(cell.orders) : ""}
          </div>
        );
      })}
    </>
  );
}

function BoxPlot({ data }) {
  const width = 960;
  const rowHeight = 42;
  const top = 36;
  const right = 48;
  const bottom = 44;
  const left = 148;
  const plotWidth = width - left - right;
  const height = top + bottom + data.length * rowHeight;
  const maxValue = Math.max(...data.map((row) => row.max), 1);
  const ticks = Array.from({ length: 5 }, (_, index) => (maxValue / 4) * index);
  const scale = (value) => left + (value / maxValue) * plotWidth;

  return (
    <svg className="boxplot-svg" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Order value distribution by outlet">
      {ticks.map((tick) => {
        const x = scale(tick);
        return (
          <g key={tick}>
            <line className="boxplot-grid" x1={x} x2={x} y1={top - 12} y2={height - bottom + 10} />
            <text className="boxplot-tick" x={x} y={height - 12} textAnchor="middle">
              {formatCurrency(tick)}
            </text>
          </g>
        );
      })}

      {data.map((row, index) => {
        const y = top + index * rowHeight + rowHeight / 2;
        const minX = scale(row.min);
        const q1X = scale(row.q1);
        const medianX = scale(row.median);
        const q3X = scale(row.q3);
        const maxX = scale(row.max);
        const boxHeight = 22;

        return (
          <g key={row.outlet}>
            <title>
              {`${row.outlet}: min ${formatCurrency(row.min)}, Q1 ${formatCurrency(row.q1)}, median ${formatCurrency(row.median)}, Q3 ${formatCurrency(row.q3)}, max ${formatCurrency(row.max)}`}
            </title>
            <text className="boxplot-label" x={left - 14} y={y + 5} textAnchor="end">
              {row.outlet}
            </text>
            <line className="boxplot-whisker" x1={minX} x2={maxX} y1={y} y2={y} />
            <line className="boxplot-cap" x1={minX} x2={minX} y1={y - 10} y2={y + 10} />
            <line className="boxplot-cap" x1={maxX} x2={maxX} y1={y - 10} y2={y + 10} />
            <rect className="boxplot-box" x={q1X} y={y - boxHeight / 2} width={Math.max(q3X - q1X, 1)} height={boxHeight} rx={4} />
            <line className="boxplot-median" x1={medianX} x2={medianX} y1={y - boxHeight / 2} y2={y + boxHeight / 2} />
            <text className="boxplot-count" x={width - 4} y={y + 5} textAnchor="end">
              {formatNumber(row.count)}
            </text>
          </g>
        );
      })}

      <text className="boxplot-caption" x={width - 4} y={20} textAnchor="end">
        Orders
      </text>
    </svg>
  );
}

function hasDateBounds(data) {
  return Boolean(data.minDate && data.maxDate);
}

function App() {
  const [filtersMeta, setFiltersMeta] = useState({
    outlets: [],
    groups: [],
    orderTypes: [],
    minDate: "",
    maxDate: ""
  });
  const [filters, setFilters] = useState(initialFilters);
  const [dashboard, setDashboard] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");

    getJson("/api/filters")
      .then((data) => {
        if (!active) return;
        setFiltersMeta(data);
        if (!hasDateBounds(data)) {
          setLoading(false);
          setDashboard(null);
          return;
        }
        setFilters((current) => ({
          ...current,
          from: data.minDate,
          to: data.maxDate
        }));
      })
      .catch((err) => {
        if (!active) return;
        setError(err.message);
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!filters.from || !filters.to) return;

    let active = true;
    setLoading(true);
    setError("");

    getJson("/api/dashboard", filters)
      .then((data) => {
        if (active) setDashboard(data);
      })
      .catch((err) => {
        if (active) setError(err.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [filters]);

  const kpis = dashboard?.kpis;
  const exportHref = useMemo(() => exportUrl(filters), [filters]);
  const categoryKeys = useMemo(() => {
    const keys = new Set();
    (dashboard?.stackedArea ?? []).forEach((row) => {
      Object.keys(row).forEach((key) => {
        if (key !== "label") {
          keys.add(key);
        }
      });
    });
    return [...keys];
  }, [dashboard]);

  function handleFilterChange(event) {
    const { name, value } = event.target;
    setFilters((current) => ({ ...current, [name]: value }));
  }

  function resetFilters() {
    setFilters({
      ...initialFilters,
      from: filtersMeta.minDate ?? "",
      to: filtersMeta.maxDate ?? ""
    });
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Burger Town</p>
          <h1>Business Analytics Dashboard</h1>
        </div>
        <div className="actions">
          <button type="button" className="icon-button" onClick={resetFilters} aria-label="Reset filters" title="Reset filters">
            <RefreshCcw size={18} />
          </button>
          <a className="button" href={exportHref}>
            <Download size={17} />
            Export
          </a>
        </div>
      </header>

      <section className="filters" aria-label="Dashboard filters">
        <label className="field">
          <span>From</span>
          <input
            name="from"
            type="date"
            min={filtersMeta.minDate ?? undefined}
            max={filtersMeta.maxDate ?? undefined}
            value={filters.from}
            onChange={handleFilterChange}
          />
        </label>
        <label className="field">
          <span>To</span>
          <input
            name="to"
            type="date"
            min={filtersMeta.minDate ?? undefined}
            max={filtersMeta.maxDate ?? undefined}
            value={filters.to}
            onChange={handleFilterChange}
          />
        </label>
        <SelectFilter label="Outlet" name="outlet" value={filters.outlet} options={filtersMeta.outlets} onChange={handleFilterChange} />
        <SelectFilter label="Category" name="group" value={filters.group} options={filtersMeta.groups} onChange={handleFilterChange} />
        <SelectFilter label="Order type" name="orderType" value={filters.orderType} options={filtersMeta.orderTypes} onChange={handleFilterChange} />
      </section>

      {error ? <div className="alert">{error}</div> : null}
      {!error && !loading && !dashboard ? (
        <div className="alert">No data loaded yet. Run the ETL command and refresh the dashboard.</div>
      ) : null}

      <section className="kpi-grid" aria-label="Key metrics">
        <KpiCard label="Revenue" value={loading || !kpis ? "Loading" : formatCurrency(kpis.revenue)} accent="#2563eb" />
        <KpiCard label="Orders" value={loading || !kpis ? "Loading" : formatNumber(kpis.orders)} accent="#16a34a" />
        <KpiCard label="Avg. order value" value={loading || !kpis ? "Loading" : formatCurrency(kpis.avgOrderValue)} accent="#f97316" />
        <KpiCard label="Items sold" value={loading || !kpis ? "Loading" : formatNumber(kpis.itemsSold)} accent="#7c3aed" />
        <KpiCard label="Line records" value={loading || !kpis ? "Loading" : formatNumber(kpis.records)} accent="#0891b2" />
      </section>

      <section className="chart-grid">
        <article className="panel panel-wide">
          <div className="panel-heading">
            <h2>Monthly Revenue Trend</h2>
            <span>{dashboard?.trend?.length ?? 0} periods</span>
          </div>
          <div className="chart">
            {dashboard?.trend?.length ? (
              <ResponsiveContainer>
                <LineChart data={dashboard.trend} margin={{ top: 12, right: 24, bottom: 8, left: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="label" minTickGap={24} />
                  <YAxis tickFormatter={(value) => `${Math.round(value / 1000)}k`} />
                  <Tooltip formatter={(value, name) => [name === "revenue" ? formatCurrency(value) : formatNumber(value), name]} />
                  <Legend />
                  <Line type="monotone" dataKey="revenue" stroke="#2563eb" strokeWidth={3} dot={false} />
                  <Line type="monotone" dataKey="orders" stroke="#16a34a" strokeWidth={2} dot={false} yAxisId={0} />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <EmptyState />
            )}
          </div>
        </article>

        <article className="panel panel-wide">
          <div className="panel-heading">
            <h2>Category Seasonality</h2>
            <span>Stacked revenue</span>
          </div>
          <div className="chart">
            {dashboard?.stackedArea?.length && categoryKeys.length ? (
              <ResponsiveContainer>
                <AreaChart data={dashboard.stackedArea} margin={{ top: 12, right: 24, bottom: 8, left: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="label" minTickGap={24} />
                  <YAxis tickFormatter={(value) => `${Math.round(value / 1000)}k`} />
                  <Tooltip formatter={(value) => formatCurrency(value)} />
                  <Legend />
                  {categoryKeys.map((key, index) => (
                    <Area
                      key={key}
                      type="monotone"
                      dataKey={key}
                      stackId="revenue"
                      fill={COLORS[index % COLORS.length]}
                      stroke={COLORS[index % COLORS.length]}
                      fillOpacity={0.78}
                    />
                  ))}
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <EmptyState />
            )}
          </div>
        </article>

        <article className="panel">
          <div className="panel-heading">
            <h2>Revenue by Category</h2>
          </div>
          <div className="chart">
            {dashboard?.categoryRevenue?.length ? (
              <ResponsiveContainer>
                <BarChart data={dashboard.categoryRevenue} margin={{ top: 12, right: 16, bottom: 48, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="label" angle={-25} textAnchor="end" interval={0} height={64} />
                  <YAxis tickFormatter={(value) => `${Math.round(value / 1000)}k`} />
                  <Tooltip formatter={(value) => formatCurrency(value)} />
                  <Bar dataKey="revenue" radius={[4, 4, 0, 0]}>
                    {dashboard.categoryRevenue.map((entry, index) => (
                      <Cell key={entry.label} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <EmptyState />
            )}
          </div>
        </article>

        <article className="panel">
          <div className="panel-heading">
            <h2>Order Type Mix</h2>
          </div>
          <div className="chart">
            {dashboard?.orderTypeRevenue?.length ? (
              <ResponsiveContainer>
                <PieChart>
                  <Pie
                    data={dashboard.orderTypeRevenue}
                    dataKey="revenue"
                    nameKey="label"
                    innerRadius={68}
                    outerRadius={108}
                    paddingAngle={3}
                  >
                    {dashboard.orderTypeRevenue.map((entry, index) => (
                      <Cell key={entry.label} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(value) => formatCurrency(value)} />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <EmptyState />
            )}
          </div>
        </article>

        <article className="panel panel-wide">
          <div className="panel-heading">
            <h2>Top Items</h2>
          </div>
          <div className="chart compact">
            {dashboard?.topItems?.length ? (
              <ResponsiveContainer>
                <BarChart data={dashboard.topItems} layout="vertical" margin={{ top: 8, right: 24, bottom: 8, left: 132 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                  <XAxis type="number" tickFormatter={(value) => `${Math.round(value / 1000)}k`} />
                  <YAxis dataKey="label" type="category" width={128} />
                  <Tooltip formatter={(value) => formatCurrency(value)} />
                  <Bar dataKey="revenue" fill="#f97316" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <EmptyState />
            )}
          </div>
        </article>

        <article className="panel panel-wide">
          <div className="panel-heading">
            <h2>Order Value Distribution</h2>
            <span>Box plot by outlet</span>
          </div>
          <div className="chart boxplot-chart">
            {dashboard?.boxPlot?.length ? <BoxPlot data={dashboard.boxPlot} /> : <EmptyState />}
          </div>
        </article>

        <article className="panel">
          <div className="panel-heading">
            <h2>Order Total Histogram</h2>
          </div>
          <div className="chart compact">
            {dashboard?.histogram?.length ? (
              <ResponsiveContainer>
                <BarChart data={dashboard.histogram} margin={{ top: 12, right: 16, bottom: 48, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="label" angle={-25} textAnchor="end" interval="preserveStartEnd" height={64} />
                  <YAxis tickFormatter={(value) => formatNumber(value)} />
                  <Tooltip formatter={(value) => [formatNumber(value), "orders"]} />
                  <Bar dataKey="orders" fill="#0891b2" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <EmptyState />
            )}
          </div>
        </article>

        <article className="panel">
          <div className="panel-heading">
            <h2>Hourly Demand</h2>
          </div>
          <div className="chart compact">
            {dashboard?.hourlyDemand?.length ? (
              <ResponsiveContainer>
                <LineChart data={dashboard.hourlyDemand} margin={{ top: 12, right: 20, bottom: 8, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="hour" minTickGap={16} />
                  <YAxis />
                  <Tooltip formatter={(value, name) => [name === "revenue" ? formatCurrency(value) : formatNumber(value), name]} />
                  <Line type="monotone" dataKey="orders" stroke="#dc2626" strokeWidth={3} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <EmptyState />
            )}
          </div>
        </article>

        <article className="panel panel-wide">
          <div className="panel-heading">
            <h2>Peak Demand Heatmap</h2>
            <span>Orders by day and hour</span>
          </div>
          <div className="chart heatmap-chart">
            {dashboard?.heatmap?.length ? <Heatmap data={dashboard.heatmap} /> : <EmptyState />}
          </div>
        </article>

        <article className="panel panel-wide">
          <div className="panel-heading">
            <h2>Price vs Quantity Sold</h2>
            <span>Top 40 items by revenue</span>
          </div>
          <div className="chart">
            {dashboard?.scatter?.length ? (
              <ResponsiveContainer>
                <ScatterChart margin={{ top: 12, right: 24, bottom: 24, left: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis
                    dataKey="avgPrice"
                    name="Avg. price"
                    type="number"
                    tickFormatter={(value) => `₹${value}`}
                  />
                  <YAxis dataKey="quantity" name="Quantity" type="number" tickFormatter={(value) => formatNumber(value)} />
                  <ZAxis dataKey="revenue" range={[80, 420]} />
                  <Tooltip content={<ScatterTooltip />} />
                  <Scatter data={dashboard.scatter} fill="#7c3aed" fillOpacity={0.72} />
                </ScatterChart>
              </ResponsiveContainer>
            ) : (
              <EmptyState />
            )}
          </div>
        </article>

        <article className="panel">
          <div className="panel-heading">
            <h2>Outlet Performance</h2>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Outlet</th>
                  <th>Revenue</th>
                  <th>Orders</th>
                  <th>AOV</th>
                </tr>
              </thead>
              <tbody>
                {(dashboard?.outletPerformance ?? []).map((row) => (
                  <tr key={row.outlet}>
                    <td>{row.outlet}</td>
                    <td>{formatCurrency(row.revenue)}</td>
                    <td>{formatNumber(row.orders)}</td>
                    <td>{formatCurrency(row.avgOrderValue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>
      </section>
    </main>
  );
}

export default App;
