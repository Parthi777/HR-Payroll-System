'use client';

import { useEffect, useRef } from 'react';
import { io, type Socket } from 'socket.io-client';

const SOCKET_URL = process.env.NEXT_PUBLIC_SOCKET_URL ?? 'http://localhost:3001';

/** Subscribe to the backend Socket.io live feed (attendance dashboard). */
export function useSocket(event: string, handler: (data: unknown) => void) {
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    const socket = io(SOCKET_URL, { transports: ['websocket'] });
    socketRef.current = socket;
    socket.on(event, handler);

    return () => {
      socket.off(event, handler);
      socket.disconnect();
    };
  }, [event, handler]);

  return socketRef;
}
