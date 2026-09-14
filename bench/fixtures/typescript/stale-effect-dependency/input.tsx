import { useEffect, useState } from 'react';

interface Invoice {
  id: string;
  total: number;
}

interface Props {
  customerId: string;
}

async function fetchInvoices(customerId: string): Promise<Invoice[]> {
  const response = await fetch(`/api/customers/${customerId}/invoices`);
  return (await response.json()) as Invoice[];
}

export function InvoiceList({ customerId }: Props) {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    fetchInvoices(customerId)
      .then((rows) => {
        if (active) setInvoices(rows);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  if (loading) return <p>Loading…</p>;

  return (
    <ul>
      {invoices.map((invoice, index) => (
        <li key={index}>
          {invoice.id}: {invoice.total}
        </li>
      ))}
    </ul>
  );
}
