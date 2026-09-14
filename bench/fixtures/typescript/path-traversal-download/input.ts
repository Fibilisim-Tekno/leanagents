import { createReadStream, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Request, Response } from 'express';

const UPLOAD_ROOT = '/var/app/uploads';

export function downloadAttachment(req: Request, res: Response): void {
  const requested = String(req.query.name ?? '');

  if (requested.length === 0) {
    res.status(400).json({ error: 'name is required' });
    return;
  }

  const target = join(UPLOAD_ROOT, requested);

  if (!existsSync(target)) {
    res.status(404).json({ error: 'not found' });
    return;
  }

  res.setHeader('Content-Disposition', `attachment; filename="${requested}"`);
  createReadStream(target).pipe(res);
}
