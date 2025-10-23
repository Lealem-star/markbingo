import { useEffect, useRef, useState, useCallback } from 'react';

export function useGameSocket(url, { onEvent, token } = {}) {
    const wsRef = useRef(null);
    const [connected, setConnected] = useState(false);
    const [lastEvent, setLastEvent] = useState(null);
    const pendingRef = useRef([]); // queue messages while socket not open
    const onEventRef = useRef(onEvent);

    // Keep latest onEvent without re-creating the socket
    useEffect(() => {
        onEventRef.current = onEvent;
    }, [onEvent]);

    const send = useCallback((type, payload) => {
        const ws = wsRef.current;
        const message = JSON.stringify({ type, payload });
        console.log('WebSocket send attempt:', { type, payload, connected, readyState: ws?.readyState });
        if (ws && ws.readyState === WebSocket.OPEN) {
            console.log('Sending WebSocket message:', message);
            ws.send(message);
        } else {
            console.warn('WebSocket not ready, queuing message:', { connected, readyState: ws?.readyState });
            pendingRef.current.push(message);
        }
    }, [connected]);

    useEffect(() => {
        if (!url || !token) return;
        let stopped = false;
        let retry = 0;
        let heartbeat = null;

        const connect = () => {
            const wsUrl = new URL(url);
            wsUrl.searchParams.set('token', token);
            const ws = new WebSocket(wsUrl.toString());
            wsRef.current = ws;

            ws.onopen = () => {
                console.log('WebSocket connected');
                setConnected(true);
                retry = 0;
                // Flush any queued messages
                try {
                    const queue = pendingRef.current;
                    pendingRef.current = [];
                    for (const msg of queue) {
                        try { ws.send(msg); } catch (e) { console.warn('Failed to flush queued msg', e); }
                    }
                } catch { }
            };
            ws.onmessage = (e) => {
                try {
                    const evt = JSON.parse(e.data);
                    try { console.debug('[WS] event:', evt.type, evt.payload); } catch { }
                    setLastEvent(evt);
                    const handler = onEventRef.current;
                    if (handler) handler(evt);
                } catch { }
            };
            ws.onclose = (event) => {
                console.log('WebSocket closed:', event.code, event.reason);
                setConnected(false);
                if (heartbeat) { clearInterval(heartbeat); heartbeat = null; }
                if (!stopped) {
                    const delay = Math.min(1000 * 2 ** retry, 10000);
                    retry += 1;
                    console.log(`Retrying connection in ${delay}ms (attempt ${retry})`);
                    setTimeout(connect, delay);
                }
            };
            ws.onerror = (error) => {
                console.error('WebSocket error:', error);
                ws.close();
            };

            // Start heartbeat keepalive every 20s
            heartbeat = setInterval(() => {
                try {
                    if (ws.readyState === WebSocket.OPEN) {
                        ws.send(JSON.stringify({ type: 'ping', payload: { ts: Date.now() } }));
                    }
                } catch (_) { }
            }, 20000);
        };

        connect();
        return () => {
            stopped = true;
            wsRef.current?.close();
            if (heartbeat) { clearInterval(heartbeat); heartbeat = null; }
        };
    }, [url, token]);

    return { connected, lastEvent, send };
}
