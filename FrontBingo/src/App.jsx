import React, { useState, useEffect } from 'react';
import Game from './pages/Game';
import Rules from './components/Rules';
import Scores from './pages/Scores';
import History from './pages/History';
import Wallet from './pages/Wallet';
import Profile from './pages/Profile';
import CartelaSelection from './pages/CartelaSelection.jsx';
import GameLayout from './pages/GameLayout.jsx';
import Winner from './pages/Winner.jsx';
import { AuthProvider } from './lib/auth/AuthProvider.jsx';
import { ToastProvider, useToast } from './contexts/ToastContext.jsx';
import { WebSocketProvider, useWebSocket } from './contexts/WebSocketContext.jsx';
import AdminLayout from './admin/AdminLayout.jsx';

// Inner component that has access to WebSocket context
function AppContent() {
  const [currentPage, setCurrentPage] = useState('game');
  const [selectedStake, setSelectedStake] = useState(null);
  const [selectedCartelas, setSelectedCartelas] = useState([]); // up to 2
  const [currentGameId, setCurrentGameId] = useState(null);
  const [isNavigating, setIsNavigating] = useState(false);
  const [connectionTimeout, setConnectionTimeout] = useState(false);

  // Access WebSocket context for smart navigation
  const { gameState, connected } = useWebSocket();
  const { showSuccess } = useToast();

  // Clear localStorage stake on mount to always start fresh
  useEffect(() => {
    localStorage.removeItem('selectedStake');
  }, []);

  // Error monitoring and debugging
  useEffect(() => {
    const logState = () => {
      console.log('🔍 App State Debug:', {
        currentPage,
        selectedStake,
        selectedCartelas,
        currentGameId,
        connected,
        gameState: {
          phase: gameState.phase,
          gameId: gameState.gameId,
          playersCount: gameState.playersCount,
          yourCards: Array.isArray(gameState.yourCards) ? gameState.yourCards.length : 0
        },
        timestamp: new Date().toISOString()
      });
    };

    // Log state every 5 seconds for debugging
    const interval = setInterval(logState, 5000);

    // Also log on state changes
    logState();

    return () => clearInterval(interval);
  }, [currentPage, selectedStake, selectedCartelas, currentGameId, connected, gameState]);

  // Specific check for authentication and initial load
  useEffect(() => {
    console.log('🚀 App initialized with:', {
      currentPage,
      selectedStake,
      connected,
      hasGameState: !!gameState,
      gamePhase: gameState?.phase,
      timestamp: new Date().toISOString()
    });
  }, []); // Run only once on mount

  // Set a timeout for WebSocket connection
  useEffect(() => {
    if (selectedStake && !connected) {
      const timeout = setTimeout(() => {
        setConnectionTimeout(true);
      }, 10000); // 10 second timeout

      return () => clearTimeout(timeout);
    } else {
      setConnectionTimeout(false);
    }
  }, [selectedStake, connected]);

  // Smart navigation function to determine the correct game page based on current state
  const determineGamePage = () => {
    console.log('Determining game page based on state:', {
      gameState: {
        phase: gameState.phase,
        gameId: gameState.gameId,
        yourCards: gameState.yourCards,
      },
      selectedStake,
      selectedCartelas,
      connected
    });

    // If we have an active game (only when there are players; otherwise game may be cancelled):
    // - Players who have cartellas go to game layout.
    // - Users without cards can still go to game layout in watch mode.
    const hasPlayers = typeof gameState.playersCount === 'number' && gameState.playersCount >= 2;
    if (gameState.phase === 'running' && gameState.gameId && hasPlayers) {
      const hasCards =
        (Array.isArray(gameState.yourCards) && gameState.yourCards.length > 0) ||
        selectedCartelas.length > 0;

      if (hasCards) {
        console.log('→ Routing to game-layout (active game with cartella)');
        return 'game-layout';
      }

      console.log('→ Routing to game-layout (watch mode - running game, no cartella for this user)');
      return 'game-layout';
    }

    // If registration just closed and game is about to start with players, show game layout
    if (gameState.phase === 'starting' && gameState.gameId && hasPlayers) {
      console.log('→ Routing to game-layout (starting game)');
      return 'game-layout';
    }

    // If we have a game in announce phase (finished), go to winner page
    if (gameState.phase === 'announce' && gameState.gameId) {
      console.log('→ Routing to winner (game finished)');
      return 'winner';
    }

    // If we have a stake and game is in registration, go to cartela selection
    if (selectedStake && gameState.phase === 'registration' && gameState.gameId) {
      console.log('→ Routing to cartela-selection (registration open)');
      return 'cartela-selection';
    }

    // If stake selected but game didn't start (e.g. not enough players) — stay on cartela selection
    if (selectedStake && (gameState.phase === 'starting' || gameState.phase === 'running') && gameState.gameId && !hasPlayers) {
      console.log('→ Routing to cartela-selection (game cancelled / not enough players)');
      return 'cartela-selection';
    }

    // If we have a stake but no active game, go to cartela selection
    if (selectedStake && (!gameState.gameId || gameState.phase === 'waiting')) {
      console.log('→ Routing to cartela-selection (stake selected, no active game)');
      return 'cartela-selection';
    }

    // If we have a stake but WebSocket not connected yet, still go to cartela selection
    if (selectedStake && !connected) {
      console.log('→ Routing to cartela-selection (stake selected, WebSocket not connected yet)');
      return 'cartela-selection';
    }

    // Default: go to main game page (stake selection)
    console.log('→ Routing to game (default - stake selection)');
    return 'game';
  };

  // Listen for custom gameStarted event as backup navigation trigger
  useEffect(() => {
    const handleGameStarted = (event) => {
      console.log('🎯 gameStarted custom event received:', event.detail);
      if (!selectedStake) return;
      
      // Navigate to game-layout when a game starts AND there are enough players.
      const playersCount = (event.detail && typeof event.detail.playersCount === 'number')
        ? event.detail.playersCount
        : gameState.playersCount;
      const hasPlayers = typeof playersCount === 'number' && playersCount >= 2;

      if (event.detail.phase === 'running' && event.detail.gameId && hasPlayers && currentPage !== 'game-layout') {
        console.log('🚀 FORCE NAVIGATING via custom event to game-layout');
        // Update selectedCartelas from gameState if available
        if (Array.isArray(gameState.yourCards) && gameState.yourCards.length > 0) {
          const cardNumbers = gameState.yourCards.map(card => card.cardNumber || card).filter(num => num != null);
          if (cardNumbers.length > 0) {
            setSelectedCartelas(cardNumbers);
          }
        }
        setCurrentPage('game-layout');
      }
    };
    
    window.addEventListener('gameStarted', handleGameStarted);
    return () => window.removeEventListener('gameStarted', handleGameStarted);
  }, [selectedStake, currentPage, gameState.yourCards, gameState.playersCount]);

  // Auto-navigate based on game state changes
  useEffect(() => {
    console.log('🔄 Auto-navigation useEffect triggered:', {
      selectedStake,
      phase: gameState.phase,
      gameId: gameState.gameId,
      currentPage,
      hasCards: Array.isArray(gameState.yourCards) && gameState.yourCards.length > 0,
      yourSelections: gameState.yourSelections
    });
    
    if (!selectedStake) {
      console.log('⏭️ Skipping auto-navigation: no stake selected');
      return; // Only auto-navigate if we have a stake selected
    }
    
    const targetPage = determineGamePage();
    console.log('🎯 Determined target page:', targetPage, {
      phase: gameState.phase,
      gameId: gameState.gameId,
      currentPage
    });
    
    // Navigate to game layout only when a real game is starting/running WITH enough players.
    const hasPlayers = typeof gameState.playersCount === 'number' && gameState.playersCount >= 2;
    const isGameStartingOrRunning =
      (gameState.phase === 'starting' || gameState.phase === 'running') && gameState.gameId && hasPlayers;
    const isGameFinished = gameState.phase === 'announce' && gameState.gameId;
    
    const shouldNavigate = 
      (isGameStartingOrRunning && currentPage !== 'game-layout') ||
      (isGameFinished && currentPage !== 'winner');
    
    console.log('🤔 Should navigate?', shouldNavigate, {
      phase: gameState.phase,
      hasGameId: !!gameState.gameId,
      gameId: gameState.gameId,
      targetPage,
      currentPage,
      isGameStartingOrRunning,
      isGameFinished,
      hasCards: Array.isArray(gameState.yourCards) && gameState.yourCards.length > 0,
      winnersCount: gameState.winners?.length || 0
    });
    
    if (shouldNavigate) {
      console.log('✅ NAVIGATING! Auto-navigating based on game state:', {
        from: currentPage,
        to: isGameStartingOrRunning ? 'game-layout' : 'winner',
        phase: gameState.phase,
        gameId: gameState.gameId,
        hasCards: Array.isArray(gameState.yourCards) && gameState.yourCards.length > 0,
        yourSelections: gameState.yourSelections,
        winnersCount: gameState.winners?.length || 0
      });
      
      // Update selectedCartelas if we have cards from gameState (for display purposes)
      // But don't block navigation if cards aren't loaded yet - GameLayout will handle loading
      if (isGameStartingOrRunning) {
        if (Array.isArray(gameState.yourCards) && gameState.yourCards.length > 0) {
          const cardNumbers = gameState.yourCards.map(card => card.cardNumber || card).filter(num => num != null);
          if (cardNumbers.length > 0) {
            console.log('📋 Setting selectedCartelas from gameState:', cardNumbers);
            setSelectedCartelas(cardNumbers);
          }
        } else if (Array.isArray(gameState.yourSelections) && gameState.yourSelections.length > 0) {
          // Fallback to yourSelections if yourCards not loaded yet
          console.log('📋 Setting selectedCartelas from yourSelections:', gameState.yourSelections);
          setSelectedCartelas(gameState.yourSelections);
        }
        // If no cards/selections, that's fine - GameLayout will show watch mode
      }
      
      setCurrentPage(isGameStartingOrRunning ? 'game-layout' : 'winner');
    } else {
      console.log('⏸️ Not navigating - conditions not met');
    }
  }, [gameState.phase, gameState.gameId, gameState.playersCount, gameState.yourCards, gameState.yourSelections, gameState.winners, selectedStake, currentPage]);

  // Handle query parameter routing for admin panel and stake
  useEffect(() => {
    const checkUrlParams = () => {
      const urlParams = new URLSearchParams(window.location.search);
      const isAdmin = urlParams.get('admin') === 'true';
      const stakeParam = urlParams.get('stake');

      console.log('URL parameters check:', { isAdmin, stakeParam }); // Debug log

      if (isAdmin) {
        setCurrentPage('admin');
      } else {
        setCurrentPage('game');

        // If stake parameter is provided, store it
        if (stakeParam) {
          const stakeValue = parseInt(stakeParam);
          if (stakeValue && [10].includes(stakeValue)) {
            console.log('Setting stake from URL parameter:', stakeValue);
            setSelectedStake(stakeValue);
            localStorage.setItem('selectedStake', stakeValue.toString());
          }
        }
      }
    };

    // Check initial URL parameters
    checkUrlParams();

    // Listen for URL changes (including query parameter changes)
    const handleUrlChange = () => {
      checkUrlParams();
    };

    window.addEventListener('popstate', handleUrlChange);

    return () => {
      window.removeEventListener('popstate', handleUrlChange);
    };
  }, []);

  // Trigger smart navigation when stake is set from URL parameters
  useEffect(() => {
    if (selectedStake && currentPage === 'game') {
      console.log('Stake set from URL, triggering smart navigation:', selectedStake);
      const targetPage = determineGamePage();
      if (targetPage !== 'game') {
        console.log('Auto-navigating to:', targetPage);
        setCurrentPage(targetPage);
      }
    }
  }, [selectedStake, currentPage]);

  const handleStakeSelected = (stake) => {
    setSelectedStake(stake);
    setCurrentPage('cartela-selection');
  };

  // Reset function to go back to main game page
  const handleResetToGame = () => {
    console.log('Resetting to main game page');
    setSelectedStake(null);
    setSelectedCartelas([]);
    setCurrentGameId(null);
    setCurrentPage('game');
  };



  const handleNavigate = (page, forceDirect = false) => {
    console.log('Navigating from', currentPage, 'to', page, 'with stake:', selectedStake, 'cartelas:', selectedCartelas, 'forceDirect:', forceDirect);

    // Add smooth transition
    setIsNavigating(true);

    // Small delay for smooth transition
    setTimeout(() => {
      if (page === 'game' && !forceDirect) {
        // Smart navigation: route to current game state instead of always resetting
        const targetPage = determineGamePage();
        console.log('Smart navigation: routing to', targetPage, 'instead of resetting');

        // Show a brief message about smart navigation
        if (targetPage !== 'game') {
          console.log(`🎯 Smart navigation: Taking you to ${targetPage} based on your current game state`);

          // Show user-friendly toast message
          const messages = {
            'game-layout': '🎮 Returning to your active game!',
            'cartela-selection': '🎫 Taking you to cartella selection',
            'winner': '🏆 Showing game results'
          };
          showSuccess(messages[targetPage] || 'Taking you to your game');
        }

        setCurrentPage(targetPage);
      } else {
        // Direct navigation - go exactly where requested
        console.log('Direct navigation to:', page);
        setCurrentPage(page);
      }
      setIsNavigating(false);
    }, 150);
  };

  const renderPage = () => {
    console.log('Rendering page:', currentPage, 'with stake:', selectedStake);
    switch (currentPage) {
      case 'game':
        return <Game onNavigate={handleNavigate} onStakeSelected={handleStakeSelected} selectedStake={selectedStake} />;
      case 'cartela-selection':
        return (
          <CartelaSelection
            onNavigate={handleNavigate}
            onResetToGame={handleResetToGame}
            stake={selectedStake}
            onCartelaSelected={(cartelaNumbers) => {
              // When cartela(s) are selected, go to the live game layout
              setSelectedCartelas(Array.isArray(cartelaNumbers) ? cartelaNumbers : []);
              setCurrentPage('game-layout');
            }}
            onGameIdUpdate={(gameId) => setCurrentGameId(gameId)}
          />
        );
      case 'admin':
        return <AdminLayout onNavigate={handleNavigate} />;
      case 'game-layout':
        return (
          <GameLayout
            onNavigate={handleNavigate}
            onResetToGame={handleResetToGame}
            stake={selectedStake}
            selectedCartelas={selectedCartelas}
          />
        );
      case 'rules':
        return <Rules onNavigate={handleNavigate} />;
      case 'scores':
        return <Scores onNavigate={handleNavigate} />;
      case 'history':
        return <History onNavigate={handleNavigate} />;
      case 'wallet':
        return <Wallet onNavigate={handleNavigate} />;
      case 'profile':
        return <Profile onNavigate={handleNavigate} />;
      case 'winner':
        return <Winner onNavigate={handleNavigate} onResetToGame={handleResetToGame} />;
      default:
        console.log('Default case - rendering Game component');
        return <Game onNavigate={handleNavigate} onStakeSelected={handleStakeSelected} selectedStake={selectedStake} />;
    }
  };

  // Fallback to ensure something always renders
  const pageContent = renderPage();

  // If no stake is selected, always show the main game page
  if (!selectedStake && currentPage === 'game') {
    console.log('🎮 No stake selected, showing main game page');
  }

  // WebSocket connects in the background; avoid full-screen loading here to prevent visual flicker

  // Safety check - ensure we always have content to render
  if (!pageContent) {
    console.error('❌ No page content to render!', {
      currentPage,
      selectedStake,
      connected,
      gameState: {
        phase: gameState.phase,
        gameId: gameState.gameId
      }
    });
  }

  return (
    <div className="App">
      {pageContent || (
        <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#e6e6fa' }}>
          <div className="text-center text-white">
            <div className="text-6xl mb-4">⚠️</div>
            <h1 className="text-2xl font-bold mb-4">Loading Error</h1>
            <p className="text-white/80 mb-6">Something went wrong. Please refresh the page.</p>
            <div className="bg-red-900/30 rounded-lg p-4 mb-4 text-left text-sm">
              <p><strong>Current Page:</strong> {currentPage}</p>
              <p><strong>Selected Stake:</strong> {selectedStake || 'none'}</p>
              <p><strong>Connected:</strong> {connected ? 'yes' : 'no'}</p>
              <p><strong>Game Phase:</strong> {gameState.phase}</p>
            </div>
            <button
              onClick={() => window.location.reload()}
              className="px-6 py-3 bg-pink-600 text-white rounded-lg font-semibold hover:bg-pink-700 transition-colors"
            >
              Refresh Page
            </button>
          </div>
        </div>
      )}

      {/* Debug Panel - Temporary for debugging */}
      {false && (
        <div className="fixed bottom-4 right-4 bg-black/80 text-white text-xs p-2 rounded max-w-xs z-50">
          <div><strong>Debug Info:</strong></div>
          <div>Page: {currentPage}</div>
          <div>Stake: {selectedStake || 'none'}</div>
          <div>Cartela: {selectedCartelas.length ? selectedCartelas.join(', ') : 'none'}</div>
          <div>WS Connected: {connected ? 'yes' : 'no'}</div>
          <div>Game Phase: {gameState.phase}</div>
          <div>Game ID: {gameState.gameId || 'none'}</div>
          <div>URL: {window.location.href}</div>
        </div>
      )}

      {/* Navigation Loading Overlay */}
      {isNavigating && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center">
          <div className="bg-white/10 backdrop-blur-md rounded-2xl p-6 text-center">
            <div className="w-8 h-8 border-2 border-white/30 border-t-white rounded-full animate-spin mx-auto mb-3"></div>
            <div className="text-white text-sm">Loading...</div>
          </div>
        </div>
      )}
    </div>
  );
}

// Main App component with providers
function App() {
  return (
    <AuthProvider>
      <ToastProvider>
        <WebSocketProvider>
          <AppContent />
        </WebSocketProvider>
      </ToastProvider>
    </AuthProvider>
  );
}

export default App;
