async function reauthenticateAndGetSession() {
    try {
        console.log('Re-authenticating due to 401...');
        const apiBase = import.meta.env.VITE_API_URL ||
            (window.location.hostname === 'localhost' ? 'http://localhost:3001' :
                'https://fikirbingo.com');
        const initData = window?.Telegram?.WebApp?.initData;

        // Try Telegram auth first
        if (initData) {
            console.log('Attempting Telegram auth...');
            const res = await fetch(`${apiBase}/auth/telegram/verify`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ initData })
            });
            if (res.ok) {
                const out = await res.json();
                console.log('Telegram auth successful:', out);
                localStorage.setItem('sessionId', out.sessionId);
                localStorage.setItem('user', JSON.stringify(out.user));
                return out.sessionId;
            }
        }

        // No fallback for production - require valid Telegram data
        console.error('Telegram authentication failed - no valid initData available');
    } catch (e) {
        console.error('Re-authentication error:', e);
    }
    return null;
}

export function getApiBase() {
    return import.meta.env.VITE_API_URL ||
        (window.location.hostname === 'localhost' ? 'http://localhost:3001' :
            'https://fikirbingo.com');
}

export async function apiFetch(path, { method = 'GET', body, sessionId, headers = {}, timeoutMs = 10000 } = {}) {
    const apiBase = getApiBase();
    const doRequest = async (sid) => {
        const requestHeaders = { ...headers };

        // Only set Content-Type for JSON, let browser set it for FormData
        if (!(body instanceof FormData)) {
            requestHeaders['Content-Type'] = 'application/json';
        }

        if (sid) {
            requestHeaders['x-session'] = sid;
            requestHeaders['Authorization'] = `Bearer ${sid}`;
        }
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
            return await fetch(`${apiBase}${path}`, {
                method,
                headers: requestHeaders,
                body: body instanceof FormData ? body : (body ? JSON.stringify(body) : undefined),
                signal: controller.signal
            });
        } finally {
            clearTimeout(timer);
        }
    };

    const initialSid = sessionId || localStorage.getItem('sessionId');
    let res;
    try {
        res = await doRequest(initialSid);
    } catch (e) {
        if (e?.name === 'AbortError') {
            console.error('API request timed out:', path);
            throw new Error('request_timeout');
        }
        throw e;
    }
    if (res.status === 401) {
        // Token likely invalid for this environment; re-authenticate and retry once
        const newSid = await reauthenticateAndGetSession();
        if (newSid) {
            try {
                res = await doRequest(newSid);
            } catch (e) {
                if (e?.name === 'AbortError') {
                    console.error('API request timed out after reauth:', path);
                    throw new Error('request_timeout');
                }
                throw e;
            }
        }
    }
    if (!res.ok) {
        const errorText = await res.text();
        console.error(`API Error ${res.status}:`, errorText);
        throw new Error(`api_error_${res.status}`);
    }
    return res.json();
}


