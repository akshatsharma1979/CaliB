import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const csvPath = path.resolve(dirname, "../../data.csv");
const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const HISTOGRAM_BUCKET_SIZE = 250;

let cachedData;

export async function getCsvHealth() {
  const rows = await loadCsvRows();
  return { status: "ok", source: "csv", rows: rows.length };
}

export async function getCsvFilters() {
  const rows = await loadCsvRows();
  const outlets = new Set();
  const groups = new Set();
  const orderTypes = new Set();
  let minTime = Number.POSITIVE_INFINITY;
  let maxTime = Number.NEGATIVE_INFINITY;

  for (const row of rows) {
    outlets.add(row.outlet);
    groups.add(row.group);
    orderTypes.add(row.orderType);
    minTime = Math.min(minTime, row.time);
    maxTime = Math.max(maxTime, row.time);
  }

  return {
    source: "csv",
    minDate: Number.isFinite(minTime) ? toDateInput(minTime) : "",
    maxDate: Number.isFinite(maxTime) ? toDateInput(maxTime) : "",
    outlets: [...outlets].sort(),
    groups: [...groups].sort(),
    orderTypes: [...orderTypes].sort()
  };
}

export async function getCsvDashboard(filters) {
  const rows = filterRows(await loadCsvRows(), filters);
  const orderTotals = new Map();
  const trend = new Map();
  const categoryRevenue = new Map();
  const orderTypeRevenue = new Map();
  const topItems = new Map();
  const outletPerformance = new Map();
  const hourlyDemand = new Map();
  const orderDistribution = new Map();
  const stackedArea = new Map();
  const heatmap = new Map();
  const scatter = new Map();

  let revenue = 0;
  let itemsSold = 0;

  for (const row of rows) {
    revenue += row.revenue;
    itemsSold += row.quantity;
    addRevenue(orderTotals, row.billNo, row.revenue);
    addGroupedMetric(trend, row.month, row.revenue, row.quantity, row.billNo);
    addGroupedMetric(categoryRevenue, row.group, row.revenue, row.quantity, row.billNo);
    addGroupedMetric(orderTypeRevenue, row.orderType, row.revenue, row.quantity, row.billNo);
    addGroupedMetric(topItems, row.item, row.revenue, row.quantity, row.billNo);
    addGroupedMetric(outletPerformance, row.outlet, row.revenue, row.quantity, row.billNo);
    addGroupedMetric(hourlyDemand, row.hour, row.revenue, row.quantity, row.billNo);
    addOrderValue(orderDistribution, row.outlet, row.billNo, row.revenue);
    addStackedRevenue(stackedArea, row.month, row.group, row.revenue);
    addHeatmapMetric(heatmap, row.dayOfWeek, row.hour, row.billNo, row.revenue);
    addScatterMetric(scatter, row.item, row.group, row.price, row.quantity, row.revenue);
  }

  const orders = orderTotals.size;

  return {
    source: "csv",
    kpis: {
      records: rows.length,
      orders,
      revenue: toCurrency(revenue),
      avgOrderValue: orders ? toCurrency(revenue / orders) : 0,
      itemsSold
    },
    trend: [...trend.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([label, metric]) => ({
        label,
        revenue: toCurrency(metric.revenue),
        orders: metric.orders.size
      })),
    categoryRevenue: byRevenue(categoryRevenue).map(([label, metric]) => ({
      label,
      revenue: toCurrency(metric.revenue),
      quantity: metric.quantity
    })),
    orderTypeRevenue: byRevenue(orderTypeRevenue).map(([label, metric]) => ({
      label,
      revenue: toCurrency(metric.revenue),
      orders: metric.orders.size
    })),
    topItems: byRevenue(topItems)
      .slice(0, 8)
      .map(([label, metric]) => ({
        label,
        revenue: toCurrency(metric.revenue),
        quantity: metric.quantity
      })),
    outletPerformance: byRevenue(outletPerformance).map(([outlet, metric]) => ({
      outlet,
      revenue: toCurrency(metric.revenue),
      orders: metric.orders.size,
      quantity: metric.quantity,
      avgOrderValue: metric.orders.size ? toCurrency(metric.revenue / metric.orders.size) : 0
    })),
    hourlyDemand: [...hourlyDemand.entries()]
      .sort(([left], [right]) => Number(left) - Number(right))
      .map(([hour, metric]) => ({
        hour: `${String(hour).padStart(2, "0")}:00`,
        revenue: toCurrency(metric.revenue),
        orders: metric.orders.size
      })),
    boxPlot: getBoxPlot(orderDistribution),
    stackedArea: getStackedArea(stackedArea),
    histogram: getHistogram([...orderTotals.values()]),
    heatmap: getHeatmap(heatmap),
    scatter: getScatter(scatter)
  };
}

export async function getCsvTopItems(filters) {
  const topItems = new Map();

  for (const row of filterRows(await loadCsvRows(), filters)) {
    addGroupedMetric(topItems, row.item, row.revenue, row.quantity, row.billNo);
  }

  return byRevenue(topItems).map(([item, metric]) => ({
    item,
    quantity: metric.quantity,
    revenue: metric.revenue
  }));
}

async function loadCsvRows() {
  if (cachedData) {
    return cachedData;
  }

  const contents = await fs.readFile(csvPath, "utf8");
  const lines = contents.trimEnd().split(/\r?\n/);
  const rows = [];

  for (let index = 1; index < lines.length; index += 1) {
    const columns = parseCsvLine(lines[index]);
    const date = parseOrderDate(columns[2]);
    const quantity = Number(columns[7]);
    const price = Number(columns[6]);

    rows.push({
      billNo: columns[0],
      outlet: columns[1],
      time: date.getTime(),
      month: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`,
      hour: date.getHours(),
      dayOfWeek: date.getDay(),
      group: columns[3],
      orderType: columns[4],
      item: columns[5],
      price,
      quantity,
      revenue: price * quantity,
      settlement: columns[8],
      brand: columns[9]
    });
  }

  cachedData = rows;
  console.warn(`Using CSV data source with ${rows.length.toLocaleString("en-IN")} rows.`);
  return cachedData;
}

function parseCsvLine(line) {
  const values = [];
  let current = "";
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (quoted && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === "," && !quoted) {
      values.push(current);
      current = "";
    } else {
      current += char;
    }
  }

  values.push(current);
  return values;
}

function parseOrderDate(value) {
  const [datePart, timePart] = value.split(" ");
  const [month, day, year] = datePart.split("/").map(Number);
  const [hour, minute, second = 0] = timePart.split(":").map(Number);
  return new Date(year, month - 1, day, hour, minute, second);
}

function filterRows(rows, filters) {
  const fromTime = filters.from ? new Date(`${filters.from}T00:00:00`).getTime() : Number.NEGATIVE_INFINITY;
  const toTime = filters.to ? new Date(`${filters.to}T23:59:59.999`).getTime() : Number.POSITIVE_INFINITY;

  return rows.filter((row) =>
    row.time >= fromTime &&
    row.time <= toTime &&
    (!filters.outlet || row.outlet === filters.outlet) &&
    (!filters.group || row.group === filters.group) &&
    (!filters.orderType || row.orderType === filters.orderType)
  );
}

function addRevenue(map, key, revenue) {
  map.set(key, (map.get(key) ?? 0) + revenue);
}

function addGroupedMetric(map, key, revenue, quantity, billNo) {
  if (!map.has(key)) {
    map.set(key, { revenue: 0, quantity: 0, orders: new Set() });
  }

  const metric = map.get(key);
  metric.revenue += revenue;
  metric.quantity += quantity;
  metric.orders.add(billNo);
}

function addStackedRevenue(map, month, group, revenue) {
  if (!map.has(month)) {
    map.set(month, { label: month });
  }

  const metric = map.get(month);
  metric[group] = (metric[group] ?? 0) + revenue;
}

function addHeatmapMetric(map, day, hour, billNo, revenue) {
  const key = `${day}:${hour}`;
  if (!map.has(key)) {
    map.set(key, { day, hour, orders: new Set(), revenue: 0 });
  }

  const metric = map.get(key);
  metric.orders.add(billNo);
  metric.revenue += revenue;
}

function addScatterMetric(map, item, group, price, quantity, revenue) {
  if (!map.has(item)) {
    map.set(item, { item, group, revenue: 0, quantity: 0 });
  }

  const metric = map.get(item);
  metric.revenue += revenue;
  metric.quantity += quantity;
  metric.avgPrice = metric.quantity ? metric.revenue / metric.quantity : price;
}

function addOrderValue(map, outlet, billNo, revenue) {
  if (!map.has(outlet)) {
    map.set(outlet, new Map());
  }

  const outletOrders = map.get(outlet);
  outletOrders.set(billNo, (outletOrders.get(billNo) ?? 0) + revenue);
}

function getStackedArea(stackedArea) {
  return [...stackedArea.values()]
    .sort((left, right) => left.label.localeCompare(right.label))
    .map((row) => {
      const next = { ...row };
      for (const [key, value] of Object.entries(next)) {
        if (key !== "label") {
          next[key] = toCurrency(value);
        }
      }
      return next;
    });
}

function getHistogram(orderValues) {
  if (!orderValues.length) {
    return [];
  }

  const maxValue = Math.max(...orderValues);
  const bucketCount = Math.ceil(maxValue / HISTOGRAM_BUCKET_SIZE) + 1;
  const buckets = Array.from({ length: bucketCount }, (_, index) => {
    const start = index * HISTOGRAM_BUCKET_SIZE;
    const end = start + HISTOGRAM_BUCKET_SIZE - 1;
    return {
      label: `${start}-${end}`,
      start,
      end,
      orders: 0
    };
  });

  for (const value of orderValues) {
    const index = Math.min(Math.floor(value / HISTOGRAM_BUCKET_SIZE), buckets.length - 1);
    buckets[index].orders += 1;
  }

  return buckets.filter((bucket) => bucket.orders > 0);
}

function getHeatmap(heatmap) {
  const cells = [];

  for (let day = 0; day < DAY_LABELS.length; day += 1) {
    for (let hour = 11; hour <= 23; hour += 1) {
      const metric = heatmap.get(`${day}:${hour}`);
      cells.push({
        day: DAY_LABELS[day],
        dayIndex: day,
        hour: `${String(hour).padStart(2, "0")}:00`,
        hourValue: hour,
        orders: metric?.orders.size ?? 0,
        revenue: toCurrency(metric?.revenue ?? 0)
      });
    }
  }

  return cells;
}

function getScatter(scatter) {
  return [...scatter.values()]
    .map((metric) => ({
      item: metric.item,
      group: metric.group,
      avgPrice: toCurrency(metric.avgPrice ?? 0),
      quantity: metric.quantity,
      revenue: toCurrency(metric.revenue)
    }))
    .sort((left, right) => right.revenue - left.revenue)
    .slice(0, 40);
}

function getBoxPlot(distribution) {
  return [...distribution.entries()]
    .map(([outlet, orders]) => {
      const values = [...orders.values()].sort((left, right) => left - right);
      return {
        outlet,
        count: values.length,
        min: toCurrency(values[0] ?? 0),
        q1: toCurrency(percentile(values, 0.25)),
        median: toCurrency(percentile(values, 0.5)),
        q3: toCurrency(percentile(values, 0.75)),
        max: toCurrency(values[values.length - 1] ?? 0)
      };
    })
    .sort((left, right) => right.median - left.median);
}

function percentile(values, ratio) {
  if (!values.length) {
    return 0;
  }

  const index = (values.length - 1) * ratio;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);

  if (lower === upper) {
    return values[lower];
  }

  return values[lower] + (values[upper] - values[lower]) * (index - lower);
}

function byRevenue(map) {
  return [...map.entries()].sort(([, left], [, right]) => right.revenue - left.revenue);
}

function toCurrency(value) {
  return Number(value.toFixed(2));
}

function toDateInput(time) {
  const date = new Date(time);
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0")
  ].join("-");
}
