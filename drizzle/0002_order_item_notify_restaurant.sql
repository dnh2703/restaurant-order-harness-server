-- Enrich the order_items NOTIFY payload with restaurantId so the realtime broker can fan a
-- single notification out to BOTH the customer (order:<id>) and staff (restaurant:<id>) topics.
-- restaurant_id is looked up from the item's order (a single PK lookup per status change).
CREATE OR REPLACE FUNCTION notify_order_item_change() RETURNS trigger AS $$
DECLARE
  v_restaurant_id uuid;
BEGIN
  SELECT restaurant_id INTO v_restaurant_id FROM orders WHERE id = NEW.order_id;
  PERFORM pg_notify(
    'realtime',
    json_build_object(
      'type', 'order_item',
      'restaurantId', v_restaurant_id,
      'orderId', NEW.order_id,
      'orderItemId', NEW.id,
      'status', NEW.status,
      'op', TG_OP
    )::text
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
-- The trigger from 0001 already points at this function name; CREATE OR REPLACE updates it in
-- place, so no DROP/CREATE TRIGGER is needed.
