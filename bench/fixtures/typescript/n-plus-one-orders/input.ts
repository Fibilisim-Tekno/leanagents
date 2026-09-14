import type { Pool } from 'pg';

interface Order {
  id: string;
  customerId: string;
  status: 'open' | 'paid' | 'shipped' | 'cancelled' | 'refunded';
}

interface OrderLine {
  orderId: string;
  sku: string;
  quantity: number;
}

export function describeStatus(status: Order['status']): string {
  switch (status) {
    case 'open':
      return 'Awaiting payment';
    case 'paid':
      return 'Paid, not yet shipped';
    case 'shipped':
      return 'On its way';
    case 'cancelled':
      return 'Cancelled before shipping';
    case 'refunded':
      return 'Refunded to the original method';
  }
}

export async function loadOrdersWithLines(
  pool: Pool,
  customerId: string,
): Promise<Array<Order & { lines: OrderLine[] }>> {
  const orders = await pool.query<Order>(
    'select id, customer_id as "customerId", status from orders where customer_id = $1',
    [customerId],
  );

  const enriched: Array<Order & { lines: OrderLine[] }> = [];

  for (const order of orders.rows) {
    const lines = await pool.query<OrderLine>(
      'select order_id as "orderId", sku, quantity from order_lines where order_id = $1',
      [order.id],
    );
    enriched.push({ ...order, lines: lines.rows });
  }

  return enriched;
}
