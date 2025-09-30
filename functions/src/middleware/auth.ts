import { Request, Response, NextFunction } from 'express';

// Store API key using environment variables or Secret Manager in production

export const validateApiKey = (req: Request, res: Response, next: NextFunction): void => {
  const apiKey = req.headers['x-api-key'] || req.query.apiKey;

  // Use environment variable (set in .env file)
  const validApiKey = process.env.API_KEY;

  if (!validApiKey) {
    console.error('API_KEY environment variable not set!');
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'API key not configured'
    });
    return;
  }

  if (!apiKey || apiKey !== validApiKey) {
    res.status(403).json({
      error: 'Forbidden',
      message: 'Invalid or missing API key'
    });
    return;
  }

  next();
};
