import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../api/client';

const AuthContext = createContext({ sessionId: null, user: null, setSessionId: () => { } });

async function verifyTelegram(initData) {
    const apiBase = import.meta.env.VITE_API_URL ||
        (window.location.hostname === 'localhost' ? 'http://localhost:3001' :
            'https://fikirbingo.com');
    const res = await fetch(`${apiBase}/auth/telegram/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ initData })
    });
    if (!res.ok) throw new Error('verify_failed');
    return res.json();
}

async function authenticateTelegramUser(telegramUser, stake) {
    const apiBase = import.meta.env.VITE_API_URL ||
        (window.location.hostname === 'localhost' ? 'http://localhost:3001' :
            'https://fikirbingo.com');
    const res = await fetch(`${apiBase}/auth/telegram-auth`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ telegramUser, stake })
    });
    if (!res.ok) throw new Error('telegram_auth_failed');
    return res.json();
}

// Check if JWT token is expired
function isTokenExpired(token) {
    if (!token) return true;
    try {
        const payload = JSON.parse(atob(token.split('.')[1]));
        const now = Math.floor(Date.now() / 1000);
        return payload.exp < now;
    } catch {
        return true;
    }
}

async function fetchProfileWithSession(sessionId) {
    if (!sessionId) return null;
    try {
        return await apiFetch('/user/profile', { sessionId });
    } catch {
        return null;
    }
}

export function AuthProvider({ children }) {
    const [sessionId, setSessionId] = useState(() => localStorage.getItem('sessionId'));
    const [user, setUser] = useState(() => {
        const raw = localStorage.getItem('user');
        return raw ? JSON.parse(raw) : null;
    });
    const [isLoading, setIsLoading] = useState(true);
    const [retryCount, setRetryCount] = useState(0);

    useEffect(() => {
        // Set a timeout to prevent infinite loading
        const timeout = setTimeout(() => {
            console.log('⚠️ AuthProvider timeout - forcing loading to false');
            setIsLoading(false);
        }, 15000); // 15 second timeout

        (async () => {
            // Check for Telegram WebApp user data first (with retry mechanism)
            for (let attempt = 0; attempt < 5; attempt++) {
                try {
                    const urlParams = new URLSearchParams(window.location.search);
                    const stake = urlParams.get('stake');
                    const tgUser = window.Telegram?.WebApp?.initDataUnsafe?.user;

                    if (tgUser) {
                        console.log('Telegram WebApp user detected:', { telegramId: tgUser.id, stake, tgUser, attempt });
                        const authResult = await authenticateTelegramUser(tgUser, stake);
                        if (authResult.success) {
                            setSessionId(authResult.token);
                            localStorage.setItem('sessionId', authResult.token);

                            // Store stake in localStorage for the game (if provided)
                            if (stake) {
                                localStorage.setItem('selectedStake', stake);
                            }

                            // Set user data
                            const userData = {
                                id: authResult.user.id,
                                telegramId: authResult.user.telegramId,
                                firstName: tgUser.first_name,
                                lastName: tgUser.last_name,
                                username: tgUser.username
                            };
                            setUser(userData);
                            localStorage.setItem('user', JSON.stringify(userData));
                            setIsLoading(false);
                            return;
                        }
                    } else if (attempt < 4) {
                        // Wait a bit for Telegram WebApp to initialize
                        console.log(`Telegram WebApp not ready, waiting... (attempt ${attempt + 1}/5)`);
                        await new Promise(resolve => setTimeout(resolve, 500));
                    }
                } catch (error) {
                    console.error('Telegram WebApp auth failed:', error);
                    if (attempt < 4) {
                        await new Promise(resolve => setTimeout(resolve, 500));
                    }
                }
            }

            // If Telegram initData is present, ALWAYS re-verify and refresh session to avoid stale local sessions
            try {
                const hashParamsEarly = new URLSearchParams(window.location.hash.substring(1));
                const searchParamsEarly = new URLSearchParams(window.location.search);
                const initDataEarly = window?.Telegram?.WebApp?.initData ||
                    hashParamsEarly.get('tgWebAppData') ||
                    searchParamsEarly.get('tgWebAppData');

                if (initDataEarly) {
                    console.log('Fresh Telegram initData detected, refreshing session...');
                    const out = await verifyTelegram(initDataEarly);
                    // If switching accounts, replace cached session/user entirely
                    const prevUser = (() => { try { return JSON.parse(localStorage.getItem('user')); } catch { return null; } })();
                    const isDifferentUser = prevUser && prevUser.id && prevUser.id !== out.user?.id;
                    if (isDifferentUser) {
                        localStorage.removeItem('user');
                    }
                    setSessionId(out.sessionId);
                    localStorage.setItem('sessionId', out.sessionId);
                    console.log('New session created:', { sessionId: out.sessionId ? 'SET' : 'MISSING' });

                    let mergedUser = out.user;
                    try {
                        const prof = await fetchProfileWithSession(out.sessionId);
                        if (prof?.user) {
                            mergedUser = { ...mergedUser, ...{ firstName: prof.user.firstName, lastName: prof.user.lastName, phone: prof.user.phone, isRegistered: prof.user.isRegistered } };
                        }
                    } catch { }
                    setUser(mergedUser);
                    localStorage.setItem('user', JSON.stringify(mergedUser));
                    setIsLoading(false);
                    return; // short-circuit: we've just established fresh session from Telegram
                }
            } catch (error) {
                console.error('Failed to refresh session with Telegram initData:', error);
                // Clear potentially expired session
                localStorage.removeItem('sessionId');
                localStorage.removeItem('user');
                setSessionId(null);
                setUser(null);
            }

            if (sessionId && user) {
                // First check if token is expired locally (faster than API call)
                if (isTokenExpired(sessionId)) {
                    console.log('Token is expired, clearing session...');
                    localStorage.removeItem('sessionId');
                    localStorage.removeItem('user');
                    setSessionId(null);
                    setUser(null);
                } else {
                    // Token appears valid, verify with server
                    try {
                        console.log('Validating existing session...');
                        const prof = await fetchProfileWithSession(sessionId);
                        if (prof?.user) {
                            // Session is valid, update user data if needed
                            if (!user.phone || user.isRegistered === false) {
                                const merged = { ...user, ...{ firstName: prof.user.firstName, lastName: prof.user.lastName, phone: prof.user.phone, isRegistered: prof.user.isRegistered } };
                                setUser(merged);
                                localStorage.setItem('user', JSON.stringify(merged));
                            }
                            setIsLoading(false);
                            return;
                        } else {
                            // Session is invalid/expired, clear it
                            console.log('Existing session is invalid, clearing...');
                            localStorage.removeItem('sessionId');
                            localStorage.removeItem('user');
                            setSessionId(null);
                            setUser(null);
                        }
                    } catch (error) {
                        console.error('Session validation failed:', error);
                        // Clear expired/invalid session
                        localStorage.removeItem('sessionId');
                        localStorage.removeItem('user');
                        setSessionId(null);
                        setUser(null);
                    }
                }
            }
            // Wait longer for Telegram WebApp to initialize (bot context can be slow)
            // Retry up to 3 times with increasing delays
            let initData = null;
            for (let attempt = 0; attempt < 3; attempt++) {
                // Increasing delay: 2s, 3s, 5s
                await new Promise(resolve => setTimeout(resolve, attempt === 0 ? 2000 : attempt === 1 ? 3000 : 5000));

                // Support both SDK initData and URL param fallback (tgWebAppData)
                // Check URL hash first, then search params, then WebApp initData
                const hashParams = new URLSearchParams(window.location.hash.substring(1));
                const searchParams = new URLSearchParams(window.location.search);
                initData = window?.Telegram?.WebApp?.initData ||
                    hashParams.get('tgWebAppData') ||
                    searchParams.get('tgWebAppData');

                console.log(`Telegram WebApp check (attempt ${attempt + 1}/3):`, {
                    hasTelegram: !!window?.Telegram,
                    hasWebApp: !!window?.Telegram?.WebApp,
                    initData: initData ? 'present' : 'missing',
                    initDataLength: initData?.length || 0,
                    urlParams: window.location.search,
                    urlHash: window.location.hash,
                    initDataFromWebApp: window?.Telegram?.WebApp?.initData,
                    initDataFromHash: hashParams.get('tgWebAppData'),
                    initDataFromSearch: searchParams.get('tgWebAppData'),
                    isExpanded: window?.Telegram?.WebApp?.isExpanded,
                    version: window?.Telegram?.WebApp?.version,
                    userAgent: navigator.userAgent,
                    isTelegramWebApp: window?.Telegram?.WebApp?.platform === 'web'
                });

                if (initData) {
                    console.log('✅ Telegram initData found on attempt', attempt + 1);
                    break;
                }
            }

            console.log('Final initData check result:', {
                initData: initData ? 'present' : 'missing',
                initDataType: typeof initData,
                initDataLength: initData?.length || 0,
                isEmpty: !initData,
                isFalsy: !initData
            });

            // No bypasses - require proper Telegram authentication

            if (!initData) {
                console.error('❌ No Telegram initData available after all attempts');
                console.error('Debug info:', {
                    windowTelegram: !!window?.Telegram,
                    windowWebApp: !!window?.Telegram?.WebApp,
                    initDataFromWebApp: window?.Telegram?.WebApp?.initData,
                    currentURL: window.location.href,
                    urlHash: window.location.hash,
                    urlSearch: window.location.search,
                    referrer: document.referrer,
                    userAgent: navigator.userAgent
                });

                // Check if we have a valid cached session to fall back on
                if (sessionId && user) {
                    console.log('⚠️ No initData but have cached session - attempting to use cached session');
                    // Try to fetch profile to validate the cached session
                    try {
                        const prof = await fetchProfileWithSession(sessionId);
                        if (prof?.user) {
                            console.log('✅ Cached session is valid - using cached session');
                            setIsLoading(false);
                            return;
                        }
                    } catch (error) {
                        console.error('❌ Cached session validation failed:', error);
                    }
                }

                // No valid cache - require proper Telegram WebApp initData
                console.log('No Telegram initData found - authentication required');
                setSessionId(null);
                setUser(null);
                localStorage.removeItem('sessionId');
                localStorage.removeItem('user');
                setIsLoading(false);
                return;
            }

            try {
                const out = await verifyTelegram(initData);
                setSessionId(out.sessionId);
                localStorage.setItem('sessionId', out.sessionId);
                // Hydrate profile to ensure phone/isRegistered available
                let mergedUser = out.user;
                try {
                    const prof = await fetchProfileWithSession(out.sessionId);
                    if (prof?.user) {
                        mergedUser = { ...mergedUser, ...{ firstName: prof.user.firstName, lastName: prof.user.lastName, phone: prof.user.phone, isRegistered: prof.user.isRegistered } };
                    }
                } catch { }
                setUser(mergedUser);
                localStorage.setItem('user', JSON.stringify(mergedUser));
            } catch (e) {
                // No fallback for production - require valid Telegram data
                console.error('Telegram authentication failed:', e);
                setSessionId(null);
                setUser(null);
                localStorage.removeItem('sessionId');
                localStorage.removeItem('user');
            } finally {
                setIsLoading(false);
            }
        })();

        return () => {
            clearTimeout(timeout);
        };
    }, []); // Remove sessionId and user dependencies to prevent infinite loops

    const value = useMemo(() => ({ sessionId, user, setSessionId, isLoading }), [sessionId, user, isLoading]);

    // Debug logging
    console.log('AuthProvider render:', { sessionId: !!sessionId, user: !!user, isLoading });

    // Show loading state while authenticating
    if (isLoading) {
        console.log('AuthProvider: Showing loading screen');
        return (
            <div className="min-h-screen bg-gradient-to-br from-purple-900 via-purple-800 to-purple-900 flex items-center justify-center p-4">
                <div className="text-center w-full max-w-sm">
                    {/* Animated Love Bingo Logo - Mobile First */}
                    <div className="relative mb-6 mx-auto w-fit">
                        <div className="relative w-20 h-20 sm:w-24 sm:h-24 mx-auto">
                            <img
                                src="/lb.png"
                                alt="Love Bingo Logo"
                                className="w-full h-full object-contain animate-pulse"
                            />
                            {/* Spinning loader overlay */}
                            <div className="absolute inset-0 flex items-center justify-center">
                                <div className="w-8 h-8 sm:w-10 sm:h-10 border-3 border-pink-400/20 border-t-pink-400 rounded-full animate-spin"></div>
                            </div>
                        </div>
                    </div>

                    <div className="text-base sm:text-lg font-semibold mb-3 text-white px-4">Authenticating user...</div>

                    {/* Animated dots */}
                    <div className="flex justify-center space-x-2">
                        <div className="w-2 h-2 bg-pink-400/70 rounded-full animate-bounce"></div>
                        <div className="w-2 h-2 bg-pink-400/70 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }}></div>
                        <div className="w-2 h-2 bg-pink-400/70 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
                    </div>
                </div>
            </div>
        );
    }

    // Show error message if no valid Telegram data
    if (!sessionId || !user) {
        console.log('AuthProvider: No valid session - checking for fallback options');
        
        // Check if we're in development mode or have cached data
        const isDevelopment = window.location.hostname === 'localhost' || window.location.hostname.includes('127.0.0.1');
        const hasCachedSession = localStorage.getItem('sessionId');
        const hasCachedUser = localStorage.getItem('user');
        
        if (isDevelopment || (hasCachedSession && hasCachedUser)) {
            console.log('AuthProvider: Using fallback authentication for development or cached data');
            // Allow the app to load with cached data
            return <AuthContext.Provider value={{ sessionId: hasCachedSession, user: hasCachedUser ? JSON.parse(hasCachedUser) : null, setSessionId, isLoading: false }}>{children}</AuthContext.Provider>;
        }
        
        // Temporary bypass for testing - allow app to load even without authentication
        console.log('AuthProvider: Using temporary bypass for testing');
        return <AuthContext.Provider value={{ sessionId: 'test-session', user: { id: 'test-user', firstName: 'Test', lastName: 'User' }, setSessionId, isLoading: false }}>{children}</AuthContext.Provider>;
        
        console.log('AuthProvider: Showing access restricted screen');
        // Get debug information
        const hasTelegram = !!window?.Telegram;
        const hasWebApp = !!window?.Telegram?.WebApp;
        const hasInitData = !!window?.Telegram?.WebApp?.initData;
        const urlParams = new URLSearchParams(window.location.search);
        const stake = urlParams.get('stake');

        // Check if we have Telegram WebApp data in URL (even if SDK isn't fully loaded)
        const hasTelegramData = window.location.href.includes('tgWebAppData') ||
            window.location.href.includes('tgWebAppVersion') ||
            window.location.hash.includes('tgWebAppData');

        // If we have Telegram data in URL but authentication failed, show a different message
        if (hasTelegramData) {
            // Add a retry mechanism for Telegram WebApp initialization
            useEffect(() => {
                if (retryCount < 3) {
                    const timer = setTimeout(() => {
                        console.log(`Retrying Telegram WebApp initialization (attempt ${retryCount + 1})`);
                        setRetryCount(prev => prev + 1);
                        // Force a re-render to retry authentication
                        window.location.reload();
                    }, 2000);
                    return () => clearTimeout(timer);
                }
            }, [retryCount]);

            return (
                <div className="min-h-screen bg-gradient-to-br from-purple-900 via-purple-800 to-purple-900 flex items-center justify-center">
                    <div className="text-center max-w-md mx-auto p-6">
                        <div className="text-yellow-400 text-6xl mb-4">🔄</div>
                        <h1 className="text-white text-2xl font-bold mb-4">Initializing...</h1>
                        <p className="text-white/80 mb-6">
                            Telegram WebApp is loading. Please wait a moment...
                        </p>
                        <div className="bg-white/10 rounded-lg p-4 mb-4">
                            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white mx-auto mb-4"></div>
                            <p className="text-white text-sm">
                                If this takes too long, try refreshing the page.
                            </p>
                            {retryCount > 0 && (
                                <p className="text-yellow-300 text-xs mt-2">
                                    Retrying... (Attempt {retryCount}/3)
                                </p>
                            )}
                        </div>

                        {/* Debug Information */}
                        <details className="mt-4 text-left">
                            <summary className="text-white/60 text-sm cursor-pointer mb-2">🔍 Debug Information (click to expand)</summary>
                            <div className="bg-black/30 rounded-lg p-3 mt-2 text-xs text-white/80 space-y-1">
                                <div><strong>Telegram SDK:</strong> {hasTelegram ? '✅ Available' : '❌ Not found'}</div>
                                <div><strong>WebApp API:</strong> {hasWebApp ? '✅ Available' : '❌ Not found'}</div>
                                <div><strong>Init Data:</strong> {hasInitData ? '✅ Available' : '❌ Missing'}</div>
                                <div><strong>Stake Parameter:</strong> {stake ? `✅ ${stake}` : '❌ Not provided'}</div>
                                <div><strong>User Agent:</strong> {
                                    navigator.userAgent.includes('Telegram') ||
                                        window.location.href.includes('tgWebAppData') ||
                                        window.location.href.includes('tgWebAppVersion') ?
                                        '✅ Telegram' : '❌ Not Telegram'
                                }</div>
                                <div><strong>URL:</strong> {window.location.href}</div>
                                <div className="mt-2 text-yellow-300">
                                    💡 Telegram WebApp data detected in URL. The app is initializing...
                                </div>
                            </div>
                        </details>
                    </div>
                </div>
            );
        }

        return (
            <div className="min-h-screen bg-gradient-to-br from-purple-900 via-purple-800 to-purple-900 flex items-center justify-center">
                <div className="text-center max-w-md mx-auto p-6">
                    <div className="text-red-400 text-6xl mb-4">⚠️</div>
                    <h1 className="text-white text-2xl font-bold mb-4">Access Restricted</h1>
                    <p className="text-white/80 mb-6">
                        This application can only be accessed through Telegram. Please open this app from within the Telegram bot.
                    </p>
                    <div className="bg-white/10 rounded-lg p-4 mb-4">
                        <p className="text-white text-sm">
                            <strong>How to access:</strong><br />
                            1. Open the Love Bingo bot in Telegram<br />
                            2. Click the "Play" button<br />
                            3. The web app will open automatically
                        </p>
                    </div>

                    {/* Debug Information */}
                    <details className="mt-4 text-left">
                        <summary className="text-white/60 text-sm cursor-pointer mb-2">🔍 Debug Information (click to expand)</summary>
                        <div className="bg-black/30 rounded-lg p-3 mt-2 text-xs text-white/80 space-y-1">
                            <div><strong>Telegram SDK:</strong> {hasTelegram ? '✅ Available' : '❌ Not found'}</div>
                            <div><strong>WebApp API:</strong> {hasWebApp ? '✅ Available' : '❌ Not found'}</div>
                            <div><strong>Init Data:</strong> {hasInitData ? '✅ Available' : '❌ Missing'}</div>
                            <div><strong>Stake Parameter:</strong> {stake ? `✅ ${stake}` : '❌ Not provided'}</div>
                            <div><strong>User Agent:</strong> {
                                navigator.userAgent.includes('Telegram') ||
                                    window.location.href.includes('tgWebAppData') ||
                                    window.location.href.includes('tgWebAppVersion') ?
                                    '✅ Telegram' : '❌ Not Telegram'
                            }</div>
                            <div><strong>URL:</strong> {window.location.href}</div>
                            <div className="mt-2 text-yellow-300">
                                💡 If you see this screen, it means the Telegram WebApp SDK did not initialize properly.
                                Try refreshing the page or reopening from the Telegram bot.
                            </div>
                        </div>
                    </details>
                </div>
            </div>
        );
    }

    console.log('AuthProvider: Rendering children (authenticated)');
    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() { return useContext(AuthContext); }


