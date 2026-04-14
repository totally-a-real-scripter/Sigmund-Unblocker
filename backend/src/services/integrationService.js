/**
 * Centralized integration wiring for Scramjet, Ultraviolet and Epoxy.
 *
 * Some deployments intentionally omit one or more integration packages, so
 * package probing is best-effort and should never prevent backend startup.
 */
import { WebSocket, WebSocketServer } from 'ws';
import { env } from '../config/env.js';
import { eventBus } from './eventBus.js';

async function probeIntegrationPackage(packageName) {
  try {
    await import(packageName);
  } catch (error) {
    const isMissingModule = error?.code === 'ERR_MODULE_NOT_FOUND';
    if (!isMissingModule) {
      eventBus.emit('log', {
        type: 'integration',
        level: 'warn',
        message: `Unable to initialize ${packageName}: ${error.message}`
      });
      return;
    }

    eventBus.emit('log', {
      type: 'integration',
      level: 'warn',
      message: `Optional integration package unavailable: ${packageName}`
    });
  }
}

void Promise.all([
  probeIntegrationPackage('scramjet'),
  probeIntegrationPackage('ultraviolet'),
  probeIntegrationPackage('epoxy-transport')
]);

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
