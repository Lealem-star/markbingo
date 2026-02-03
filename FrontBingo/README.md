# FUN Bingo - React Frontend

A modern, mobile-first bingo game application built with React and Tailwind CSS.

## Features

- **Game Page**: Main bingo game interface with stake selection
- **Scores**: Leaderboard and player rankings
- **History**: Game history and statistics
- **Wallet**: Balance management and transactions
- **Profile**: User profile and account settings

## Tech Stack

- **Frontend**: React 19
- **Styling**: Tailwind CSS
- **Build Tool**: Vite
- **Navigation**: Custom state-based routing

## Getting Started

1. Install dependencies:
   ```bash
   npm install
   ```

2. Start development server:
   ```bash
   npm run dev
   ```

3. Open your browser and navigate to the local development URL

## Project Structure

```
src/
├── pages/
│   ├── Game.jsx    # Main game page
│   ├── Scores.jsx       # Leaderboard page
│   ├── History.jsx      # Game history page
│   ├── Wallet.jsx       # Wallet management page
│   └── Profile.jsx      # User profile page
├── App.jsx              # Main app component with navigation
├── main.jsx            # Entry point
└── index.css           # Tailwind CSS imports
```

## Navigation

The app uses a bottom navigation bar with 5 main sections:
- 🎮 **Game** - Main bingo game interface
- 🏆 **Scores** - Player rankings and leaderboard
- 🔄 **History** - Game history and statistics
- 💰 **Wallet** - Balance and transaction management
- 👤 **Profile** - User account and settings

## Design Features

- Mobile-first responsive design
- Beautiful gradient backgrounds
- Modern card-based UI components
- Consistent navigation across all pages
- Tailwind CSS utility classes for styling

## Development

- **Hot Reload**: Changes are reflected immediately in the browser
- **Tailwind CSS**: Utility-first CSS framework for rapid UI development
- **Component-based**: Modular React components for maintainability

## Backend Integration

This frontend is designed to work with the Express.js backend located in the `Bingo-Back` directory, which includes:
- Express server with REST API endpoints
- MongoDB integration with Mongoose
- Telegram bot functionality with Telegraf
- Environment configuration with dotenv
