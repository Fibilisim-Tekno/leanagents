interface ChargeResult {
  chargeId: string;
  status: 'succeeded' | 'failed';
}

interface OrderRecord {
  id: string;
  paid: boolean;
  chargeId?: string;
}

declare const gateway: {
  charge(orderId: string, amountCents: number): Promise<ChargeResult>;
};

declare const orders: {
  markPaid(orderId: string, chargeId: string): Promise<void>;
  find(orderId: string): Promise<OrderRecord>;
};

const logger = { warn: (message: string, error: unknown) => void [message, error] };

export async function settleOrder(orderId: string, amountCents: number): Promise<OrderRecord> {
  let chargeId = '';

  try {
    const result = await gateway.charge(orderId, amountCents);
    chargeId = result.chargeId;
  } catch (error) {
    logger.warn('charge failed', error);
  }

  await orders.markPaid(orderId, chargeId);

  return orders.find(orderId);
}
