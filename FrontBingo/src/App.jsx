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
  const [selectedStake, setSelectedStake] = useState(() => {
    const stored = localStorage.getItem('selectedStake');
    return stored ? parseInt(stored) : null;
  });
  const [selectedCartela, setSelectedCartela] = useState(null);
  const [currentGameId, setCurrentGameId] = useState(null);
  const [isNavigating, setIsNavigating] = useState(false);

  // Access WebSocket context for smart navigation
  const { gameState, connected } = useWebSocket();
  const { showSuccess } = useToast();

  // Smart navigation function to determine the correct game page based on current state
  const determineGamePage = () => {
    console.log('Determining game page based on state:', {
      gameState: {
        phase: gameState.phase,
        gameId: gameState.gameId,
        yourCard: gameState.yourCard,
        yourCardNumber: gameState.yourCardNumber,
        isWatchMode: gameState.isWatchMode
      },
      selectedStake,
      selectedCartela,
      connected
    });

    // If we have an active game and the player has a cartella, go to game layout
    if (gameState.phase === 'running' && gameState.gameId && (gameState.yourCard || gameState.yourCardNumber || selectedCartela)) {
      console.log('→ Routing to game-layout (active game with cartella)');
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
          if (stakeValue && [10, 25, 50, 100].includes(stakeValue)) {
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
    setSelectedCartela(null);
    setCurrentGameId(null);
    setCurrentPage('game');
  };



  const handleNavigate = (page, forceDirect = false) => {
    console.log('Navigating from', currentPage, 'to', page, 'with stake:', selectedStake, 'cartela:', selectedCartela, 'forceDirect:', forceDirect);

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
            onCartelaSelected={(cartelaNumber) => {
              // When a cartella is selected (or null for watch mode), go to the live game layout
              setSelectedCartela(cartelaNumber);
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
            stake={selectedStake}
            selectedCartela={selectedCartela}
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
        return <Winner onNavigate={handleNavigate} />;
      default:
        console.log('Default case - rendering Game component');
        return <Game onNavigate={handleNavigate} onStakeSelected={handleStakeSelected} selectedStake={selectedStake} />;
    }
  };

  // Fallback to ensure something always renders
  const pageContent = renderPage();

  return (
    <div className="App">
      {pageContent || (
        <div className="min-h-screen bg-gradient-to-br from-purple-900 via-purple-800 to-purple-900 flex items-center justify-center">
          <div className="text-center text-white">
            <div className="text-6xl mb-4">⚠️</div>
            <h1 className="text-2xl font-bold mb-4">Loading Error</h1>
            <p className="text-white/80 mb-6">Something went wrong. Please refresh the page.</p>
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
      {true && (
        <div className="fixed bottom-4 right-4 bg-black/80 text-white text-xs p-2 rounded max-w-xs z-50">
          <div><strong>Debug Info:</strong></div>
          <div>Page: {currentPage}</div>
          <div>Stake: {selectedStake || 'none'}</div>
          <div>Cartela: {selectedCartela || 'none'}</div>
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
