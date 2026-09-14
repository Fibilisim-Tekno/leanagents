import type { Pool } from 'pg';

interface Wallet {
  userId: string;
  creditCents: number;
}

const MINIMUM_SPEND_CENTS = 100;

export async function spendCredit(
  pool: Pool,
  userId: string,
  amountCents: number,
): Promise<Wallet> {
  if (amountCents < MINIMUM_SPEND_CENTS) {
    throw new Error('amount below minimum');
  }

  const current = await pool.query<Wallet>(
    'select user_id as "userId", credit_cents as "creditCents" from wallets where user_id = $1',
    [userId],
  );

  const wallet = current.rows[0];
  if (wallet === undefined) {
    throw new Error('wallet not found');
  }

  if (wallet.creditCents < amountCents) {
    throw new Error('insufficient credit');
  }

  const remaining = wallet.creditCents - amountCents;

  await pool.query('update wallets set credit_cents = $1 where user_id = $2', [
    remaining,
    userId,
  ]);

  return { userId, creditCents: remaining };
}
