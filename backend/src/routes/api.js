import { Router } from 'express';
import { proxyHttpRequest } from '../services/proxyService.js';
import { metricsService } from '../services/metricsService.js';

export const apiRouter = Router();

apiRouter.get('/health', (req, res) => {
  res.json({ ok: true, service: 'sigmund-unblocker', metrics: metricsService.snapshot() });
});

apiRouter.all('/proxy', proxyHttpRequest);

apiRouter.get('/metrics', (req, res) => {
  res.json(metricsService.snapshot());
});
