#!/bin/bash

# Fikir Bingo Server Setup Script
# Run this script on your VPS server after connecting via SSH

set -e  # Exit on error

echo "🚀 Starting Fikir Bingo Server Setup..."
echo "======================================"

# Update system
echo "📦 Updating system packages..."
apt update && apt upgrade -y

# Install essential tools
echo "📦 Installing essential tools..."
apt install -y curl wget git build-essential

# Install Node.js 20.x
echo "📦 Installing Node.js 20.x..."
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs

# Verify Node.js installation
echo "✅ Node.js version: $(node --version)"
echo "✅ npm version: $(npm --version)"

# Install PM2
echo "📦 Installing PM2..."
npm install -g pm2

# Install Nginx
echo "📦 Installing Nginx..."
apt install -y nginx

# Install Certbot
echo "📦 Installing Certbot for SSL..."
apt install -y certbot python3-certbot-nginx

# Configure firewall
echo "🔥 Configuring firewall..."
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw allow 3001/tcp
ufw --force enable

# Create app directory
echo "📁 Creating application directory..."
mkdir -p /var/www/fikirbingo
mkdir -p /var/www/fikirbingo/Bingo-Back/logs

echo ""
echo "✅ Server setup completed!"
echo ""
echo "Next steps:"
echo "1. Upload your code to /var/www/fikirbingo/"
echo "2. Run: cd /var/www/fikirbingo/Bingo-Back && npm install"
echo "3. Run: cd /var/www/fikirbingo/FrontBingo && npm install && npm run build"
echo "4. Configure Nginx (see DEPLOYMENT_GUIDE.md)"
echo "5. Setup SSL certificate: certbot --nginx -d fikirbingo.com -d www.fikirbingo.com"
echo "6. Start backend: cd /var/www/fikirbingo/Bingo-Back && pm2 start ecosystem.config.js && pm2 save"
echo ""

