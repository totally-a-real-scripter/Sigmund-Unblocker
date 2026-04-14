/**
 * Centralized integration wiring for Scramjet, Ultraviolet and Epoxy.
 * These libraries are intentionally imported here so backend startup fails fast
 * if one integration is missing from the deployment image.
 */
import 'scramjet';
import 'ultraviolet';
import 'epoxy-transport';
import { WebSocket, WebSocketServer } from 'ws';
import { env } from '../config/env.js';
import { eventBus } from './eventBus.js';

export function attachWispTransportBridge(server) {
  const wsServer = new WebSocketServer({ noServer: true });

  server.on('upgrade', (request, socket, head) => {
    if (!request.url?.startsWith('/ws/transport')) return;
    wsServer.handleUpgrade(request, socket, head, (clientSocket) => {
      const upstream = new WebSocket(env.wispWsUrl);

      upstream.on('open', () => eventBus.emit('log', { type: 'transport', level: 'info', message: 'Connected to Wisp transport' }));
      upstream.on('message', (msg) => clientSocket.send(msg));
      upstream.on('close', () => clientSocket.close());
      upstream.on('error', (error) => {
        eventBus.emit('log', { type: 'transport', level: 'error', message: error.message });
        clientSocket.close(1011, 'Upstream transport error');
      });

      clientSocket.on('message', (msg) => {
        if (upstream.readyState === WebSocket.OPEN) upstream.send(msg);
      });
      clientSocket.on('close', () => upstream.close());
    });
  });
}
