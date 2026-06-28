CREATE OR REPLACE FUNCTION notify_order_item_change() RETURNS trigger AS $$
BEGIN
  PERFORM pg_notify(
    'realtime',
    json_build_object(
      'type', 'order_item',
      'orderId', NEW.order_id,
      'orderItemId', NEW.id,
      'status', NEW.status,
      'op', TG_OP
    )::text
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER order_items_notify
  AFTER INSERT OR UPDATE OF status ON order_items
  FOR EACH ROW EXECUTE FUNCTION notify_order_item_change();
