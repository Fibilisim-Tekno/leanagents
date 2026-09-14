export interface CartItem {
  sku: string;
  unitPrice: number;
  quantity: number;
}

const TAX_RATE = 0.2;

export function subtotal(items: CartItem[]): number {
  let total = 0;
  for (const item of items) {
    total += item.unitPrice * item.quantity;
  }
  return total;
}

export function withTax(amount: number): number {
  return amount + amount * TAX_RATE;
}

export function formatAmount(amount: number): string {
  return `£${amount.toFixed(2)}`;
}

export function applyDiscountCode(amount: number, code: string): number {
  const percent = parseInt(code.replace('SAVE', ''));
  return amount - (amount * percent) / 100;
}
