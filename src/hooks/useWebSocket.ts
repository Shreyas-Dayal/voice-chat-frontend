// hooks/useWebSocket.ts
import { useState, useRef, useCallback, useEffect } from 'react';

export interface UseWebSocketReturn {
  connect: () => void;
  disconnect: (code?: number, reason?: string) => void;
  sendMessage: (data: string | ArrayBuffer | Blob) => void;
  isConnected: boolean;
  isConnecting: boolean;
  error: string | null;
  setOnMessageHandler: (h: (e: MessageEvent) => void) => void;
  setOnOpenHandler: (h: () => void) => void;
  setOnCloseHandler: (h: (e: CloseEvent) => void) => void;
  setOnErrorHandler: (h: (e: Event) => void) => void;
  readyState: number | undefined;
}

export function useWebSocket(url: string): UseWebSocketReturn {
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ws = useRef<WebSocket | null>(null);
  const retryCount = useRef(0);
  const maxRetries = 5;
  const baseDelayMs = 1000;

  // user‑provided handlers
  const onOpenHandler = useRef<(() => void) | null>(null);
  const onCloseHandler = useRef<((e: CloseEvent) => void) | null>(null);
  const onMessageHandler = useRef<((e: MessageEvent) => void) | null>(null);
  const onErrorHandler = useRef<((e: Event) => void) | null>(null);

  // internal connect logic; `manual=true` resets retryCount
  const doConnect = useCallback(
    (manual: boolean) => {
      if (manual) retryCount.current = 0;

      if (ws.current?.readyState === WebSocket.OPEN) return;
      if (isConnecting) return;

      setIsConnecting(true);
      setError(null);

      try {
        const socket = new WebSocket(url);
        socket.binaryType = 'arraybuffer';
        ws.current = socket;

        socket.onopen = () => {
          setIsConnected(true);
          setIsConnecting(false);
          retryCount.current = 0;
          setError(null);
          onOpenHandler.current?.();
        };

        socket.onmessage = (evt) => {
          if (onMessageHandler.current) {
            onMessageHandler.current(evt);
          } else {
            console.warn('[useWebSocket] no message handler');
          }
        };

        socket.onerror = (evt) => {
          console.error('[useWebSocket] error', evt);
          setError('WebSocket error');
          onErrorHandler.current?.(evt);
          // leave isConnected/isConnecting here—onclose will handle retries
        };

        socket.onclose = (evt) => {
          setIsConnected(false);
          setIsConnecting(false);

          const clean =
            evt.code === 1000 || evt.code === 1001 || evt.code === 1005;
          if (!clean && retryCount.current < maxRetries) {
            const delay = baseDelayMs * 2 ** retryCount.current;
            console.warn(
              `[useWebSocket] unexpected close (${evt.code}); retry #${
                retryCount.current + 1
              } in ${delay}ms`
            );
            setTimeout(() => {
              retryCount.current += 1;
              doConnect(false);
            }, delay);
          } else if (!clean) {
            console.error(
              `[useWebSocket] gave up after ${retryCount.current} retries`
            );
          }

          onCloseHandler.current?.(evt);
        };
      } catch (e) {
        console.error('[useWebSocket] connect threw', e);
        setError(`Init failed: ${e}`);
        setIsConnecting(false);
        ws.current = null;
      }
    },
    [url, isConnecting]
  );

  // public API
  const connect = useCallback(() => doConnect(true), [doConnect]);

  const disconnect = useCallback(
    (code = 1000, reason = 'User disconnect') => {
      // prevent further auto‑retries by forcing a clean close
      retryCount.current = maxRetries;
      if (ws.current?.readyState === WebSocket.OPEN) {
        ws.current.close(code, reason);
      }
    },
    []
  );

  const sendMessage = useCallback((data: string | ArrayBuffer | Blob) => {
    const ready = ws.current?.readyState;
    console.log(
      `[useWebSocket] sendMessage: state=${ready}, size=${
        data instanceof ArrayBuffer
          ? data.byteLength
          : data instanceof Blob
          ? data.size
          : (data as string).length
      }`
    );
    if (ws.current?.readyState === WebSocket.OPEN) {
      try {
        ws.current.send(data);
      } catch (e) {
        console.error('[useWebSocket] send error', e);
        setError(`Send failed: ${e}`);
      }
    } else {
      console.warn(`[useWebSocket] cannot send, state ${ready}`);
    }
  }, []);

  // cleanup on unmount
  useEffect(() => {
    return () => {
      retryCount.current = maxRetries;
      ws.current?.close(1001, 'Component unmount');
    };
  }, []);

  // setters for user handlers
  const setOnOpenHandler = useCallback((h: () => void) => {
    onOpenHandler.current = h;
  }, []);
  const setOnMessageHandler = useCallback((h: (e: MessageEvent) => void) => {
    onMessageHandler.current = h;
  }, []);
  const setOnCloseHandler = useCallback((h: (e: CloseEvent) => void) => {
    onCloseHandler.current = h;
  }, []);
  const setOnErrorHandler = useCallback((h: (e: Event) => void) => {
    onErrorHandler.current = h;
  }, []);

  return {
    connect,
    disconnect,
    sendMessage,
    isConnected,
    isConnecting,
    error,
    setOnMessageHandler,
    setOnOpenHandler,
    setOnCloseHandler,
    setOnErrorHandler,
    readyState: ws.current?.readyState,
  };
}
