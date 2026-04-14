import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import compression from 'compression';
import morgan from 'morgan';
import { env } from './config/env.js';
import { securityMiddleware } from './middleware/security.js';
import { apiRouter } from './routes/api.js';
import { logsRouter } from './routes/logs.js';
import { attachWispTransportBridge } from './services/integrationService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const frontendPath = path.resolve(__dirname, '../../frontend/public');

const app = express();
app.disable('x-powered-by');
app.use(compression());
app.use(express.json({ limit: '1mb' }));
app.use(morgan('combined'));
app.use(securityMiddleware);

app.use('/api', apiRouter);
app.use('/logs', logsRouter);

// Placeholder mount points for Ultraviolet and Scramjet static assets/workers.
app.use('/uv/', express.static(path.resolve(__dirname, '../node_modules/ultraviolet/dist')));
app.use('/scram/', express.static(path.resolve(__dirname, '../node_modules/scramjet')));

app.use(express.static(frontendPath));
app.get('*', (req, res) => res.sendFile(path.join(frontendPath, 'index.html')));

const server = http.createServer(app);
attachWispTransportBridge(server);

server.listen(env.port, env.host, () => {
  console.log(`Sigmund Unblocker backend running on http://${env.host}:${env.port}`);
});
