import type { Request, Response } from 'express';

interface LoginBody {
  email: string;
  password: string;
}

declare const authService: {
  login(email: string, password: string): Promise<{ token: string }>;
};

declare const logger: {
  info(message: string, context: unknown): void;
};

export async function login(req: Request, res: Response): Promise<void> {
  const body = req.body as LoginBody;
  logger.info('login attempt', body);

  try {
    const result = await authService.login(body.email, body.password);
    res.json(result);
  } catch (error: unknown) {
    const err = error as Error;
    res.status(500).json({ error: err.message, stack: err.stack });
  }
}
