#!/bin/bash

# Love Bingo Bot Deployment Script
echo "🚀 Deploying Love Bingo Bot..."

# Create logs directory
mkdir -p logs

# Install PM2 globally if not installed
if ! command -v pm2 &> /dev/null; then
    echo "📦 Installing PM2..."
    npm install -g pm2
fi

# Install dependencies
echo "📦 Installing dependencies..."
npm install

# Stop existing processes
echo "🛑 Stopping existing processes..."
pm2 stop love-bingo-bot 2>/dev/null || true
pm2 delete love-bingo-bot 2>/dev/null || true

# Start with PM2
echo "🤖 Starting bot with PM2..."
pm2 start ecosystem.config.js

# Save PM2 configuration
pm2 save

# Setup PM2 to start on system boot
pm2 startup

echo "✅ Deployment completed!"
echo "📊 Check status: pm2 status"
echo "📝 View logs: pm2 logs love-bingo-bot"
