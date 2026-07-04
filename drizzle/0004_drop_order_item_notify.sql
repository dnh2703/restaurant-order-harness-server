-- Realtime SSE was removed (see docs/decisions/0022): order-item status is delivered by polling
-- (GET /api/qr/:qrToken/order, GET /api/kitchen/queue). With no broker LISTENing, this trigger
-- would only fire pg_notify into the void on every order_items write, so drop it and its function.
DROP TRIGGER IF EXISTS order_items_notify ON order_items;
--> statement-breakpoint
DROP FUNCTION IF EXISTS notify_order_item_change();
