import type { Request, Response } from 'express';

const MAX_RETRIES = 3;

interface WebhookEvent {
  id: string;
  type: string;
  payload: unknown;
}

async function persistEvent(event: WebhookEvent): Promise<void> {
  await database.events.insert(event);
}

async function notifyDownstream(event: WebhookEvent): Promise<void> {
  await fetch('https://downstream.internal/events', {
    method: 'POST',
    body: JSON.stringify(event),
  });
}

export async function handleWebhook(req: Request, res: Response): Promise<void> {
  const event = req.body as WebhookEvent;

  await persistEvent(event);

  notifyDownstream(event);

  res.status(202).json({ accepted: true, retries: MAX_RETRIES });
}

declare const database: {
  events: { insert(event: WebhookEvent): Promise<void> };
};
