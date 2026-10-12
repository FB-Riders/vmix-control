// Transport: gets the raw Scorepad byte stream over TCP.
//
//   listen   The Scorepad connects to this machine (direct RJ45 setup; Bodet default port 4001).
//   connect  This machine connects to the RJ45/RS232 interface (Moxa NPort in "TCP server" mode).

import net from 'node:net';

export interface SourceOptions {
  mode: 'listen' | 'connect';
  host: string;
  port: number;
  onData: (chunk: Buffer) => void;
  onConnection: (connected: boolean, peer: string) => void;
  log: (message: string) => void;
  /** The port could not be opened (listen mode), e.g. because another program holds it. */
  onError?: (message: string) => void;
}

export interface Source {
  close(): Promise<void>;
}

const RECONNECT_MIN_MS = 1000;
const RECONNECT_MAX_MS = 10_000;
// In connect mode a silent link is torn down and re-dialled; this catches half-open sockets.
const CONNECT_IDLE_TIMEOUT_MS = 30_000;

function attach(socket: net.Socket, options: SourceOptions, onClose: () => void): string {
  const peer = `${socket.remoteAddress}:${socket.remotePort}`;
  socket.setNoDelay(true);
  socket.setKeepAlive(true, 5000);
  socket.on('data', options.onData);
  socket.on('error', (error) => options.log(`socket error (${peer}): ${error.message}`));
  socket.on('close', onClose);
  return peer;
}

function listen(options: SourceOptions): Source {
  let current: net.Socket | null = null;

  const server = net.createServer((socket) => {
    // Only one console feeds the scoreboard: a new connection replaces the previous one.
    current?.destroy();
    current = socket;
    const peer = attach(socket, options, () => {
      if (current !== socket) return;
      current = null;
      options.onConnection(false, peer);
    });
    options.onConnection(true, peer);
  });
  server.on('error', (error) => {
    options.log(`cannot listen on ${options.host}:${options.port}: ${error.message}`);
    options.onError?.(error.message);
  });
  server.listen(options.port, options.host, () =>
    options.log(`waiting for the Scorepad on tcp://${options.host}:${options.port}`),
  );

  return {
    close: () =>
      new Promise((resolve) => {
        current?.destroy();
        server.close(() => resolve());
      }),
  };
}

function connect(options: SourceOptions): Source {
  let socket: net.Socket | null = null;
  let timer: NodeJS.Timeout | null = null;
  let delay = RECONNECT_MIN_MS;
  let closed = false;

  const dial = () => {
    timer = null;
    let established = false;
    const s = net.connect({ host: options.host, port: options.port });
    socket = s;
    s.setTimeout(CONNECT_IDLE_TIMEOUT_MS, () => s.destroy(new Error('no data received, reconnecting')));
    const peer = `${options.host}:${options.port}`;
    s.on('connect', () => {
      established = true;
      delay = RECONNECT_MIN_MS;
      options.onConnection(true, peer);
    });
    attach(s, options, () => {
      if (established) options.onConnection(false, peer);
      if (closed) return;
      timer = setTimeout(dial, delay);
      delay = Math.min(delay * 2, RECONNECT_MAX_MS);
    });
  };

  options.log(`connecting to the Scorepad interface at tcp://${options.host}:${options.port}`);
  dial();

  return {
    close: async () => {
      closed = true;
      if (timer) clearTimeout(timer);
      socket?.destroy();
    },
  };
}

export function createSource(options: SourceOptions): Source {
  return options.mode === 'listen' ? listen(options) : connect(options);
}
