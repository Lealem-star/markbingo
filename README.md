# 🎯 Mark Bingo - Full Stack Bingo Game Platform

A modern, real-time multiplayer Bingo game platform with integrated payment system, Telegram bot support, and comprehensive admin dashboard.

## 📋 Overview

Mark Bingo is a complete web-based bingo game application that allows users to play bingo games in real-time, manage their wallet, view game history, and compete on leaderboards. The platform includes a Telegram bot for game management and notifications, along with a robust admin panel for game administration.

## ✨ Features

### 🎮 Game Features
- **Real-time Bingo Gameplay**: Live game sessions with WebSocket support
- **Multiple Stake Levels**: Choose from different betting amounts
- **Cartella Selection**: Select and purchase bingo cards before games
- **Audio Feedback**: Sound effects for number calls (B1-B15, I16-I30, N31-N45, G46-G60, O61-O75)
- **Winner Announcements**: Real-time winner notifications
- **Game History**: Track all past games and results

### 💰 Wallet & Payments
- **Wallet System**: Integrated wallet for deposits and withdrawals
- **Transaction History**: Complete record of all financial transactions
- **Payment Methods**: Support for multiple payment methods (see [PAYMENT_METHODS.md](./PAYMENT_METHODS.md))
- **Balance Management**: Easy deposit and withdrawal functionality

### 🤖 Telegram Integration
- **Telegram Bot**: Full game management via Telegram
- **Bot Players**: Automated bot players for enhanced gameplay
- **Notifications**: Real-time game updates and notifications
- **Admin Commands**: Game control through Telegram commands

### 👨‍💼 Admin Features
- **Admin Dashboard**: Comprehensive statistics and user management
- **Game Control**: Start, stop, and manage games
- **User Management**: View and manage user accounts and balances
- **Analytics**: Game statistics and performance metrics

## 🏗️ Architecture

### Frontend (`FrontBingo/`)
- **Framework**: React 19 with Vite
- **Styling**: Tailwind CSS 4
- **State Management**: React Context API
- **Real-time Communication**: WebSocket connections
- **Routing**: Custom state-based navigation

### Backend (`Bingo-Back/`)
- **Runtime**: Node.js with Express 5
- **Database**: MongoDB with Mongoose
- **Real-time**: WebSocket Server (ws)
- **Authentication**: JWT (JSON Web Tokens)
- **Bot Framework**: Telegraf (Telegram Bot API)
- **Process Management**: PM2

## 📁 Project Structure

```
markbingo/
├── FrontBingo/              # React frontend application
│   ├── src/
│   │   ├── pages/          # Main application pages
│   │   ├── components/     # Reusable UI components
│   │   ├── contexts/       # React contexts (WebSocket, Toast)
│   │   ├── lib/            # Utilities and helpers
│   │   └── admin/          # Admin panel components
│   ├── public/             # Static assets
│   └── package.json
│
├── Bingo-Back/             # Node.js backend application
│   ├── routes/             # API route handlers
│   ├── models/             # MongoDB models
│   ├── services/           # Business logic services
│   ├── config/             # Configuration files
│   ├── bots/               # Bot implementations
│   ├── telegram/           # Telegram bot handlers
│   └── package.json
│
├── DEPLOYMENT_GUIDE.md     # Detailed deployment instructions
├── QUICK_DEPLOY.md         # Quick deployment guide
├── PAYMENT_METHODS.md      # Payment integration details
└── README.md               # This file
```

## 🚀 Quick Start

### Prerequisites
- Node.js 20.x or higher
- MongoDB database
- npm or yarn package manager
- (Optional) Telegram Bot Token for bot features

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/Lealem-star/markbingo.git
   cd markbingo
   ```

2. **Install Frontend Dependencies**
   ```bash
   cd FrontBingo
   npm install
   ```

3. **Install Backend Dependencies**
   ```bash
   cd ../Bingo-Back
   npm install
   ```

4. **Configure Environment Variables**

   Create a `.env` file in `Bingo-Back/`:
   ```env
   PORT=3000
   MONGODB_URI=your_mongodb_connection_string
   JWT_SECRET=your_jwt_secret_key
   TELEGRAM_BOT_TOKEN=your_telegram_bot_token
   # Add other required environment variables
   ```

5. **Start Development Servers**

   **Backend:**
   ```bash
   cd Bingo-Back
   npm run dev
   ```

   **Frontend:**
   ```bash
   cd FrontBingo
   npm run dev
   ```

## 📚 Documentation

- **[DEPLOYMENT_GUIDE.md](./DEPLOYMENT_GUIDE.md)**: Complete server deployment guide
- **[QUICK_DEPLOY.md](./QUICK_DEPLOY.md)**: Quick deployment instructions
- **[PAYMENT_METHODS.md](./PAYMENT_METHODS.md)**: Payment integration details
- **[FrontBingo/README.md](./FrontBingo/README.md)**: Frontend-specific documentation

## 🛠️ Available Scripts

### Backend Scripts (`Bingo-Back/`)
- `npm start` - Start production server
- `npm run dev` - Start development server with nodemon
- `npm run bot:start` - Start player bot
- `npm run pm2:start` - Start with PM2 process manager
- `npm run deploy` - Deploy with PM2

### Frontend Scripts (`FrontBingo/`)
- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm run preview` - Preview production build
- `npm run lint` - Run ESLint

## 🔧 Technology Stack

### Frontend
- React 19.1.1
- Vite 7.1.2
- Tailwind CSS 4.1.12
- WebSocket Client

### Backend
- Node.js
- Express 5.1.0
- MongoDB with Mongoose 8.18.0
- WebSocket Server (ws 8.18.0)
- Telegraf 4.16.3 (Telegram Bot)
- JWT Authentication
- PM2 (Process Management)

## 🌐 API Endpoints

The backend provides RESTful API endpoints for:
- Authentication (`/api/auth/*`)
- User management (`/api/user/*`)
- Wallet operations (`/api/wallet/*`)
- Game operations (`/api/general/*`)
- Admin functions (`/api/admin/*`)
- SMS webhooks (`/api/sms/*`)

## 🔐 Security

- JWT-based authentication
- CORS configuration
- Environment variable management
- Secure WebSocket connections

## 📱 Mobile Support

The frontend is built with a mobile-first approach, ensuring optimal experience on:
- Mobile devices
- Tablets
- Desktop browsers

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## 📄 License

This project is licensed under the ISC License.

## 👤 Author

**Lealem-star**
- GitHub: [@Lealem-star](https://github.com/Lealem-star)

## 🔗 Links

- Repository: [https://github.com/Lealem-star/markbingo](https://github.com/Lealem-star/markbingo)

---

**Note**: Make sure to configure all environment variables before running the application. Refer to the deployment guides for production setup instructions.

