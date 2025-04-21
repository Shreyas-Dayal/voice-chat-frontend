import { useState, useRef, useCallback, useEffect } from 'react';

// Define the type for the hook's return value
interface UseWebSocketReturn {
    connect: () => void;
    disconnect: (code?: number, reason?: string) => void;
    sendMessage: (data: string | ArrayBuffer | Blob) => void;
    isConnected: boolean;
    isConnecting: boolean;
    error: string | null;
    setOnMessageHandler: (handler: (event: MessageEvent) => void) => void;
    setOnOpenHandler: (handler: () => void) => void;
    setOnCloseHandler: (handler: (event: CloseEvent) => void) => void;
    setOnErrorHandler: (handler: (event: Event) => void) => void;
    readyState: number | undefined;
}

export function useWebSocket(url: string): UseWebSocketReturn {
    const [isConnected, setIsConnected] = useState<boolean>(false);
    const [isConnecting, setIsConnecting] = useState<boolean>(false);
    const [error, setError] = useState<string | null>(null);
    const ws = useRef<WebSocket | null>(null);

    // Store handlers in refs with correct types
    const onMessageHandler = useRef<((event: MessageEvent) => void) | null>(null);
    const onOpenHandler = useRef<(() => void) | null>(null);
    const onCloseHandler = useRef<((event: CloseEvent) => void) | null>(null);
    const onErrorHandler = useRef<((event: Event) => void) | null>(null);

    const connect = useCallback(() => {
        if (ws.current && ws.current.readyState === WebSocket.OPEN) {
            console.log('[useWebSocket] Already connected.');
            return;
        }
         if (isConnecting) {
            console.log('[useWebSocket] Connection attempt already in progress.');
            return;
        }

        console.log('[useWebSocket] Attempting connection...');
        setIsConnecting(true);
        setError(null);

        try {
            ws.current = new WebSocket(url);
            ws.current.binaryType = "arraybuffer";

            ws.current.onopen = () => {
                console.log('[useWebSocket] Connected.');
                setIsConnected(true);
                setIsConnecting(false);
                setError(null);
                if (onOpenHandler.current) {
                    onOpenHandler.current();
                }
            };

            ws.current.onclose = (event: CloseEvent) => {
                console.log('[useWebSocket] Disconnected:', event.code, event.reason);
                setIsConnected(false);
                setIsConnecting(false);
                const currentWs = ws.current; // Capture ref value
                ws.current = null; // Clear ref
                if (currentWs) { // Check if close was expected
                    if (event.code !== 1000 && event.code !== 1001 && event.code !== 1005) { // 1001 = Going Away (unmount), 1005 = No Status Recvd (clean close)
                        setError(`Disconnected: ${event.reason || `Code ${event.code}`}`);
                    }
                }
                if (onCloseHandler.current) {
                    onCloseHandler.current(event);
                }
            };

            ws.current.onerror = (event: Event) => {
                console.error('[useWebSocket] Error:', event);
                setError('WebSocket connection error.');
                 if (onErrorHandler.current) {
                    onErrorHandler.current(event);
                }
                // Ensure states are updated after error
                setIsConnected(false);
                setIsConnecting(false);
                // Don't close here, let the browser handle closing after error event
            };

            ws.current.onmessage = (event: MessageEvent) => {
                if (onMessageHandler.current) {
                    onMessageHandler.current(event);
                } else {
                    console.warn('[useWebSocket] Received message but no handler set.');
                }
            };
        } catch (connectionError) {
             console.error('[useWebSocket] Connection initialization error:', connectionError);
             setError(`Failed to initialize connection: ${connectionError instanceof Error ? connectionError.message : String(connectionError)}`);
             setIsConnecting(false);
             ws.current = null;
        }

    }, [url, isConnecting]); // Added isConnecting dependency

    const disconnect = useCallback((code: number = 1000, reason: string = "User disconnected") => {
        if (ws.current && ws.current.readyState === WebSocket.OPEN) {
            console.log(`[useWebSocket] Disconnecting: ${code} - ${reason}`);
            ws.current.close(code, reason);
        } else {
            // console.log('[useWebSocket] Cannot disconnect, socket not open or null.');
        }
    }, []);

    const sendMessage = useCallback((data: string | ArrayBuffer | Blob) => {
        // *** ADD LOG HERE ***
        const readyState = ws.current?.readyState;
        console.log(`[useWebSocket] sendMessage called. ReadyState: ${readyState}, Data type: ${typeof data}, Size: ${data instanceof ArrayBuffer ? data.byteLength : data instanceof Blob ? data.size : data.length}`);

        if (ws.current && readyState === WebSocket.OPEN) { // Check explicitly for OPEN (1)
            try {
                ws.current.send(data);
                // console.log('[useWebSocket] sendMessage: Data sent successfully.'); // Optional success log
            } catch (err) {
                console.error('[useWebSocket] Error sending message:', err);
                setError(`Failed to send message: ${err instanceof Error ? err.message : String(err)}`);
            }
        } else {
            console.warn(`[useWebSocket] Cannot send message, socket not open (State: ${readyState}).`);
            // Avoid setting error state here for transient issues
        }
    }, []); // No external dependencies needed here

    // Effect to cleanup WebSocket on unmount
    useEffect(() => {
        return () => {
            // Component is unmounting, perform a clean disconnect
            disconnect(1001, "Component unmounting");
        };
    }, [disconnect]);

    // Functions to set handlers (add explicit types)
    const setOnMessageHandler = useCallback((handler: (event: MessageEvent) => void) => {
        onMessageHandler.current = handler;
    }, []);
    const setOnOpenHandler = useCallback((handler: () => void) => {
        onOpenHandler.current = handler;
    }, []);
     const setOnCloseHandler = useCallback((handler: (event: CloseEvent) => void) => {
        onCloseHandler.current = handler;
    }, []);
     const setOnErrorHandler = useCallback((handler: (event: Event) => void) => {
        onErrorHandler.current = handler;
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