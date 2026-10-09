import { Router } from "express";
import { z } from "zod";
import { getCsvDashboard, getCsvFilters, getCsvHealth, getCsvTopItems } from "./csvData.js";
import { query } from "./db.js";

const router = Router();
const CACHE_TTL_MS = 60_000;
const HISTOGRAM_BUCKET_SIZE = 250;
const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const cache = new Map();

function asyncHandler(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

const filterSchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  outlet: z.string().trim().min(1).optional(),
  group: z.string().trim().min(1).optional(),
  orderType: z.string().trim().min(1).optional()
});

function cacheKey(label, params) {
  return `${label}:${JSON.stringify(params)}`;
}

async function cached(label, params, loader) {
  const key = cacheKey(label, params);
  const found = cache.get(key);
  if (found && Date.now() - found.createdAt < CACHE_TTL_MS) {
    return found.value;
  }

  const value = await loader();
  cache.set(key, { createdAt: Date.now(), value });
  return value;
}

function buildWhere(filters) {
  const clauses = [];
  const values = [];

  if (filters.from) {
    values.push(filters.from);
    clauses.push(`order_datetime >= $${values.length}::date`);
  }

  if (filters.to) {
    values.push(filters.to);
    clauses.push(`order_datetime < ($${values.length}::date + INTERVAL '1 day')`);
  }

  if (filters.outlet) {
    values.push(filters.outlet);
    clauses.push(`outlet_name = $${values.length}`);
  }

  if (filters.group) {
    values.push(filters.group);
    clauses.push(`item_group = $${values.length}`);
  }

  if (filters.orderType) {
    values.push(filters.orderType);
    clauses.push(`order_type = $${values.length}`);
  }

  return {
    where: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "",
    values
  };
}

function parseFilters(req) {
  const parsed = filterSchema.safeParse(req.query);
  if (!parsed.success) {
    const error = new Error("Invalid filters");
    error.status = 400;
    error.details = parsed.error.flatten();
    throw error;
  }
  return parsed.data;
}

function toNumber(value) {
  return Number(value ?? 0);
}

function toCurrency(value) {
  return Number(Number(value ?? 0).toFixed(2));
}

router.get("/health", asyncHandler(async (_req, res) => {
  const data = await withCsvFallback(
    async () => {
      const result = await query("SELECT COUNT(*)::int AS rows FROM order_line_items;");
      return { status: "ok", source: "postgres", rows: result.rows[0].rows };
    },
    getCsvHealth
  );
  res.json(data);
}));

router.get("/filters", asyncHandler(async (_req, res) => {
  const data = await cached("filters", {}, async () => {
    return withCsvFallback(async () => {
      const [bounds, outlets, groups, orderTypes] = await Promise.all([
        query(`
          SELECT
            MIN(order_datetime)::date AS min_date,
            MAX(order_datetime)::date AS max_date
          FROM order_line_items;
        `),
        query("SELECT outlet_name AS value FROM order_line_items GROUP BY outlet_name ORDER BY outlet_name;"),
        query("SELECT item_group AS value FROM order_line_items GROUP BY item_group ORDER BY item_group;"),
        query("SELECT order_type AS value FROM order_line_items GROUP BY order_type ORDER BY order_type;")
      ]);

      return {
        source: "postgres",
        minDate: bounds.rows[0].min_date,
        maxDate: bounds.rows[0].max_date,
        outlets: outlets.rows.map((row) => row.value),
        groups: groups.rows.map((row) => row.value),
        orderTypes: orderTypes.rows.map((row) => row.value)
      };
    }, getCsvFilters);
  });

  res.json(data);
}));

router.get("/dashboard", asyncHandler(async (req, res) => {
  const filters = parseFilters(req);
  const data = await cached("dashboard", filters, async () => {
    return withCsvFallback(async () => {
      const { where, values } = buildWhere(filters);

      const [
        summary,
        trend,
        categoryRevenue,
        orderTypeRevenue,
        topItems,
        outletPerformance,
        hourlyDemand,
        boxPlot,
        stackedArea,
        histogram,
        heatmap,
        scatter
      ] = await Promise.all([
        query(`
          WITH order_totals AS (
            SELECT bill_no, SUM(line_revenue) AS order_revenue
            FROM order_line_items
            ${where}
            GROUP BY bill_no
          )
          SELECT
            (SELECT COUNT(*) FROM order_line_items ${where})::int AS records,
            COUNT(*)::int AS orders,
            COALESCE(SUM(order_revenue), 0) AS revenue,
            COALESCE(AVG(order_revenue), 0) AS avg_order_value,
            (SELECT COALESCE(SUM(quantity), 0) FROM order_line_items ${where})::int AS items_sold
          FROM order_totals;
        `, values),
        query(`
          SELECT
            TO_CHAR(DATE_TRUNC('month', order_datetime), 'YYYY-MM') AS label,
            SUM(line_revenue) AS revenue,
            COUNT(DISTINCT bill_no)::int AS orders
          FROM order_line_items
          ${where}
          GROUP BY DATE_TRUNC('month', order_datetime)
          ORDER BY DATE_TRUNC('month', order_datetime);
        `, values),
        query(`
          SELECT item_group AS label, SUM(line_revenue) AS revenue, SUM(quantity)::int AS quantity
          FROM order_line_items
          ${where}
          GROUP BY item_group
          ORDER BY revenue DESC;
        `, values),
        query(`
          SELECT order_type AS label, SUM(line_revenue) AS revenue, COUNT(DISTINCT bill_no)::int AS orders
          FROM order_line_items
          ${where}
          GROUP BY order_type
          ORDER BY revenue DESC;
        `, values),
        query(`
          SELECT item AS label, SUM(line_revenue) AS revenue, SUM(quantity)::int AS quantity
          FROM order_line_items
          ${where}
          GROUP BY item
          ORDER BY revenue DESC
          LIMIT 8;
        `, values),
        query(`
          SELECT
            outlet_name AS outlet,
            SUM(line_revenue) AS revenue,
            COUNT(DISTINCT bill_no)::int AS orders,
            SUM(quantity)::int AS quantity
          FROM order_line_items
          ${where}
          GROUP BY outlet_name
          ORDER BY revenue DESC;
        `, values),
        query(`
          SELECT
            EXTRACT(HOUR FROM order_datetime)::int AS hour,
            SUM(line_revenue) AS revenue,
            COUNT(DISTINCT bill_no)::int AS orders
          FROM order_line_items
          ${where}
          GROUP BY hour
          ORDER BY hour;
        `, values),
        query(`
          WITH order_totals AS (
            SELECT outlet_name, bill_no, SUM(line_revenue) AS order_revenue
            FROM order_line_items
            ${where}
            GROUP BY outlet_name, bill_no
          )
          SELECT
            outlet_name AS outlet,
            COUNT(*)::int AS count,
            MIN(order_revenue) AS min,
            PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY order_revenue) AS q1,
            PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY order_revenue) AS median,
            PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY order_revenue) AS q3,
            MAX(order_revenue) AS max
          FROM order_totals
          GROUP BY outlet_name
          ORDER BY median DESC;
        `, values),
        query(`
          SELECT
            TO_CHAR(DATE_TRUNC('month', order_datetime), 'YYYY-MM') AS label,
            item_group,
            SUM(line_revenue) AS revenue
          FROM order_line_items
          ${where}
          GROUP BY DATE_TRUNC('month', order_datetime), item_group
          ORDER BY DATE_TRUNC('month', order_datetime), item_group;
        `, values),
        query(`
          WITH order_totals AS (
            SELECT bill_no, SUM(line_revenue) AS order_revenue
            FROM order_line_items
            ${where}
            GROUP BY bill_no
          )
          SELECT
            FLOOR(order_revenue / ${HISTOGRAM_BUCKET_SIZE})::int * ${HISTOGRAM_BUCKET_SIZE} AS start,
            COUNT(*)::int AS orders
          FROM order_totals
          GROUP BY start
          ORDER BY start;
        `, values),
        query(`
          WITH demand AS (
            SELECT
              EXTRACT(DOW FROM order_datetime)::int AS day_index,
              EXTRACT(HOUR FROM order_datetime)::int AS hour_value,
              COUNT(DISTINCT bill_no)::int AS orders,
              SUM(line_revenue) AS revenue
            FROM order_line_items
            ${where}
            GROUP BY day_index, hour_value
          )
          SELECT day_index, hour_value, orders, revenue
          FROM demand
          WHERE hour_value BETWEEN 11 AND 23
          ORDER BY day_index, hour_value;
        `, values),
        query(`
          SELECT
            item,
            item_group,
            SUM(line_revenue) / NULLIF(SUM(quantity), 0) AS avg_price,
            SUM(quantity)::int AS quantity,
            SUM(line_revenue) AS revenue
          FROM order_line_items
          ${where}
          GROUP BY item, item_group
          ORDER BY revenue DESC
          LIMIT 40;
        `, values)
      ]);

      const kpis = summary.rows[0];
      return {
        source: "postgres",
        kpis: {
          records: toNumber(kpis.records),
          orders: toNumber(kpis.orders),
          revenue: toCurrency(kpis.revenue),
          avgOrderValue: toCurrency(kpis.avg_order_value),
          itemsSold: toNumber(kpis.items_sold)
        },
        trend: trend.rows.map((row) => ({
          label: row.label,
          revenue: toCurrency(row.revenue),
          orders: toNumber(row.orders)
        })),
        categoryRevenue: categoryRevenue.rows.map((row) => ({
          label: row.label,
          revenue: toCurrency(row.revenue),
          quantity: toNumber(row.quantity)
        })),
        orderTypeRevenue: orderTypeRevenue.rows.map((row) => ({
          label: row.label,
          revenue: toCurrency(row.revenue),
          orders: toNumber(row.orders)
        })),
        topItems: topItems.rows.map((row) => ({
          label: row.label,
          revenue: toCurrency(row.revenue),
          quantity: toNumber(row.quantity)
        })),
        outletPerformance: outletPerformance.rows.map((row) => ({
          outlet: row.outlet,
          revenue: toCurrency(row.revenue),
          orders: toNumber(row.orders),
          quantity: toNumber(row.quantity),
          avgOrderValue: row.orders > 0 ? toCurrency(row.revenue / row.orders) : 0
        })),
        hourlyDemand: hourlyDemand.rows.map((row) => ({
          hour: `${String(row.hour).padStart(2, "0")}:00`,
          revenue: toCurrency(row.revenue),
          orders: toNumber(row.orders)
        })),
        boxPlot: boxPlot.rows.map((row) => ({
          outlet: row.outlet,
          count: toNumber(row.count),
          min: toCurrency(row.min),
          q1: toCurrency(row.q1),
          median: toCurrency(row.median),
          q3: toCurrency(row.q3),
          max: toCurrency(row.max)
        })),
        stackedArea: toStackedArea(stackedArea.rows),
        histogram: histogram.rows.map((row) => {
          const start = toNumber(row.start);
          const end = start + HISTOGRAM_BUCKET_SIZE - 1;
          return {
            label: `${start}-${end}`,
            start,
            end,
            orders: toNumber(row.orders)
          };
        }),
        heatmap: toHeatmap(heatmap.rows),
        scatter: scatter.rows.map((row) => ({
          item: row.item,
          group: row.item_group,
          avgPrice: toCurrency(row.avg_price),
          quantity: toNumber(row.quantity),
          revenue: toCurrency(row.revenue)
        }))
      };
    }, () => getCsvDashboard(filters));
  });

  res.json(data);
}));

router.get("/export/top-items.csv", asyncHandler(async (req, res) => {
  const filters = parseFilters(req);
  const result = await withCsvFallback(async () => {
    const { where, values } = buildWhere(filters);
    const dbResult = await query(`
      SELECT item, SUM(quantity)::int AS quantity, SUM(line_revenue) AS revenue
      FROM order_line_items
      ${where}
      GROUP BY item
      ORDER BY revenue DESC;
    `, values);
    return dbResult.rows;
  }, () => getCsvTopItems(filters));

  const rows = [
    "item,quantity,revenue",
    ...result.map((row) =>
      [row.item, row.quantity, Number(row.revenue).toFixed(2)]
        .map((value) => `"${String(value).replace(/"/g, '""')}"`)
        .join(",")
    )
  ];

  res.header("Content-Type", "text/csv");
  res.attachment("top-items.csv");
  res.send(rows.join("\n"));
}));

async function withCsvFallback(postgresLoader, csvLoader) {
  try {
    return await postgresLoader();
  } catch (error) {
    if (!isDatabaseUnavailable(error)) {
      throw error;
    }

    console.warn(`Postgres unavailable (${error.code}); falling back to data.csv.`);
    return csvLoader();
  }
}

function isDatabaseUnavailable(error) {
  return ["28P01", "3D000", "42P01", "ECONNREFUSED", "ENOTFOUND", "ETIMEDOUT"].includes(error.code);
}

function toStackedArea(rows) {
  const months = new Map();

  for (const row of rows) {
    if (!months.has(row.label)) {
      months.set(row.label, { label: row.label });
    }

    months.get(row.label)[row.item_group] = toCurrency(row.revenue);
  }

  return [...months.values()];
}

function toHeatmap(rows) {
  const found = new Map(rows.map((row) => [`${row.day_index}:${row.hour_value}`, row]));
  const cells = [];

  for (let day = 0; day < DAY_LABELS.length; day += 1) {
    for (let hour = 11; hour <= 23; hour += 1) {
      const row = found.get(`${day}:${hour}`);
      cells.push({
        day: DAY_LABELS[day],
        dayIndex: day,
        hour: `${String(hour).padStart(2, "0")}:00`,
        hourValue: hour,
        orders: toNumber(row?.orders),
        revenue: toCurrency(row?.revenue)
      });
    }
  }

  return cells;
}

export default router;
