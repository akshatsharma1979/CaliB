CREATE TABLE IF NOT EXISTS order_line_items (
  id BIGSERIAL PRIMARY KEY,
  bill_no BIGINT NOT NULL,
  outlet_name TEXT NOT NULL,
  order_datetime TIMESTAMP WITHOUT TIME ZONE NOT NULL,
  item_group TEXT NOT NULL,
  order_type TEXT NOT NULL,
  item TEXT NOT NULL,
  price NUMERIC(10, 2) NOT NULL CHECK (price >= 0),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  settlement TEXT NOT NULL,
  brand TEXT NOT NULL,
  line_revenue NUMERIC(12, 2) GENERATED ALWAYS AS (price * quantity) STORED
);

CREATE INDEX IF NOT EXISTS idx_order_line_items_datetime
  ON order_line_items (order_datetime);

CREATE INDEX IF NOT EXISTS idx_order_line_items_bill_no
  ON order_line_items (bill_no);

CREATE INDEX IF NOT EXISTS idx_order_line_items_filters
  ON order_line_items (outlet_name, item_group, order_type);

CREATE INDEX IF NOT EXISTS idx_order_line_items_group_revenue
  ON order_line_items (item_group, line_revenue);

CREATE INDEX IF NOT EXISTS idx_order_line_items_item
  ON order_line_items (item);
