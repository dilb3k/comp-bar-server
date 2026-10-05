import http from "node:http";

export function createHttpServer(listener: http.RequestListener) {
  const server = http.createServer(listener);
  // Keep upstream proxy sockets reusable; avoid a new TCP handshake per call.
  server.keepAliveTimeout = 65000;
  server.headersTimeout = 66000;
  server.requestTimeout = 120000;
  return server;
}
