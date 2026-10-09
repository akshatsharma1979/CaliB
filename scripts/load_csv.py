#!/usr/bin/env python3
import argparse
import csv
import os
import subprocess
import tempfile
from datetime import datetime
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DATABASE_URL = "postgres://calib:calib@localhost:5432/calib"
EXPECTED_COLUMNS = [
    "BillNo",
    "Outlet_Name",
    "Order_Datetime",
    "Group",
    "Order_Type",
    "Item",
    "Price",
    "Quantity",
    "Settlement",
    "Brand",
]
TARGET_COLUMNS = [
    "bill_no",
    "outlet_name",
    "order_datetime",
    "item_group",
    "order_type",
    "item",
    "price",
    "quantity",
    "settlement",
    "brand",
]


def parse_order_datetime(value):
    value = value.strip()
    for fmt in ("%m/%d/%Y %H:%M:%S", "%m/%d/%Y %H:%M"):
        try:
            return datetime.strptime(value, fmt)
        except ValueError:
            continue
    raise ValueError(f"Unsupported Order_Datetime value: {value}")


def row_to_tuple(row):
    return {
        "bill_no": int(row["BillNo"]),
        "outlet_name": row["Outlet_Name"].strip(),
        "order_datetime": parse_order_datetime(row["Order_Datetime"]).strftime("%Y-%m-%d %H:%M:%S"),
        "item_group": row["Group"].strip(),
        "order_type": row["Order_Type"].strip(),
        "item": row["Item"].strip(),
        "price": row["Price"].strip(),
        "quantity": int(row["Quantity"]),
        "settlement": row["Settlement"].strip(),
        "brand": row["Brand"].strip(),
    }


def run_psql(database_url, args):
    command = ["psql", database_url, "-v", "ON_ERROR_STOP=1", *args]
    subprocess.run(command, check=True)


def ensure_schema(database_url):
    schema_path = ROOT / "db" / "schema.sql"
    run_psql(database_url, ["-f", str(schema_path)])

def transform_csv(csv_path, output_path):
    loaded = 0
    with csv_path.open("r", encoding="utf-8", newline="") as csv_file:
        reader = csv.DictReader(csv_file)
        if reader.fieldnames != EXPECTED_COLUMNS:
            raise ValueError(
                f"Unexpected CSV columns. Expected {EXPECTED_COLUMNS}, got {reader.fieldnames}"
            )

        with output_path.open("w", encoding="utf-8", newline="") as output_file:
            writer = csv.DictWriter(output_file, fieldnames=TARGET_COLUMNS)
            writer.writeheader()
            for row in reader:
                writer.writerow(row_to_tuple(row))
                loaded += 1
                if loaded % 50_000 == 0:
                    print(f"Loaded {loaded:,} rows")

    print(f"Loaded {loaded:,} rows")
    return loaded


def load_csv(database_url, csv_path, reset):
    ensure_schema(database_url)

    if reset:
        run_psql(database_url, ["-c", "TRUNCATE TABLE order_line_items RESTART IDENTITY;"])

    with tempfile.NamedTemporaryFile("w", suffix=".csv", delete=False) as temp_file:
        transformed_path = Path(temp_file.name)

    try:
        total = transform_csv(csv_path, transformed_path)
        escaped_path = str(transformed_path).replace("'", "''")
        columns = ", ".join(TARGET_COLUMNS)
        copy_command = (
            f"\\copy order_line_items ({columns}) "
            f"FROM '{escaped_path}' WITH (FORMAT csv, HEADER true)"
        )
        run_psql(database_url, ["-c", copy_command])
        run_psql(database_url, ["-c", "ANALYZE order_line_items;"])
        return total
    finally:
        transformed_path.unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser(description="Load CaliB CSV data into PostgreSQL.")
    parser.add_argument("--csv", default=str(ROOT / "data.csv"), help="Path to the CSV file.")
    parser.add_argument("--database-url", default=os.getenv("DATABASE_URL", DEFAULT_DATABASE_URL))
    parser.add_argument("--reset", action="store_true", help="Truncate existing rows before loading.")
    args = parser.parse_args()

    csv_path = Path(args.csv).resolve()
    if not csv_path.exists():
        raise FileNotFoundError(f"CSV file not found: {csv_path}")

    total = load_csv(args.database_url, csv_path, args.reset)

    print(f"Finished loading {total:,} rows into PostgreSQL.")


if __name__ == "__main__":
    main()
