import { Router } from 'express';
import { eventBus } from '../services/eventBus.js';

export const logsRouter = Router();

logsRouter.get('/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const onLog = (entry) => {
    res.write(`data: ${JSON.stringify({ ts: new Date().toISOString(), ...entry })}\n\n`);
  };

  eventBus.on('log', onLog);
  const heartbeat = setInterval(() => res.write(': ping\n\n'), 15000);

  req.on('close', () => {
    clearInterval(heartbeat);
    eventBus.off('log', onLog);
  });
});
