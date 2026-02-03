# 🚀 Fikir Bingo Deployment Guide

## Server Information
- **Domain**: fikirbingo.com
- **IP Address**: 207.180.197.118
- **SSH Username**: root
- **SSH Password**: SHu18Q36

---

## Step 1: Connect to Your Server

### On Windows (using PowerShell or Command Prompt):
```bash
ssh root@207.180.197.118
```
When prompted, enter password: `SHu18Q36`

### On Mac/Linux:
```bash
ssh root@207.180.197.118
```

---

## Step 2: Initial Server Setup

Once connected, run these commands:

```bash
# Update system packages
apt update && apt upgrade -y

# Install essential tools
apt install -y curl wget git build-essential

# Install Node.js 20.x (LTS)
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs

# Verify installations
node --version  # Should show v20.x.x
npm --version   # Should show 10.x.x

# Install PM2 globally
npm install -g pm2

# Install Nginx
apt install -y nginx

# Install Certbot for SSL certificates
apt install -y certbot python3-certbot-nginx

# Configure firewall
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw allow 3001/tcp  # Backend API port
ufw --force enable
```

---

## Step 3: Upload Your Code to Server

### Option A: Using Git (Recommended)
```bash
# Create app directory
mkdir -p /var/www/fikirbingo
cd /var/www/fikirbingo

# Clone your repository (if you have one)
# git clone https://your-repo-url.git .

# OR upload files manually using SCP/SFTP
```

### Option B: Using SCP (from your local machine)
```bash
# From your local machine (Windows PowerShell or Mac/Linux terminal)
# Navigate to your project directory first

# Upload backend
scp -r Bingo-Back root@207.180.197.118:/var/www/fikirbingo/

# Upload frontend
scp -r FrontBingo root@207.180.197.118:/var/www/fikirbingo/
```

### Option C: Using WinSCP (Windows GUI)
1. Download WinSCP: https://winscp.net/
2. Connect to: `207.180.197.118` with username `root` and password `SHu18Q36`
3. Upload both `Bingo-Back` and `FrontBingo` folders to `/var/www/fikirbingo/`

---

## Step 4: Setup Backend

```bash
cd /var/www/fikirbingo/Bingo-Back

# Install dependencies
npm install

# Create logs directory
mkdir -p logs

# Update ecosystem.config.js with production URLs
# (We'll do this in the next step)
```

### Update Environment Variables

Edit `ecosystem.config.js` to ensure production URLs:
```bash
nano ecosystem.config.js
```

Make sure these are set correctly:
- `WEBAPP_URL: 'https://fikirbingo.com'`
- `API_BASE_URL: 'https://fikirbingo.com'` (for bots)

---

## Step 5: Build Frontend

```bash
cd /var/www/fikirbingo/FrontBingo

# Install dependencies
npm install

# Build for production
npm run build

# The build output will be in the 'dist' folder
```

---

## Step 6: Configure Nginx

Create nginx configuration file:

```bash
nano /etc/nginx/sites-available/fikirbingo.com
```

Paste this configuration:

```nginx
# Backend API - WebSocket and HTTP
upstream backend {
    server localhost:3001;
}

# Frontend static files
server {
    listen 80;
    server_name fikirbingo.com www.fikirbingo.com;

    # Frontend static files
    root /var/www/fikirbingo/FrontBingo/dist;
    index index.html;

    # Frontend routes
    location / {
        try_files $uri $uri/ /index.html;
    }

    # Backend API
    location /api/ {
        proxy_pass http://backend;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }

    # WebSocket support
    location /ws {
        proxy_pass http://backend;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Other backend routes
    location ~ ^/(auth|wallet|user|admin|sms-forwarder|sms-webhook|health) {
        proxy_pass http://backend;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Static assets caching
    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot|mp3)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }
}
```

Enable the site:
```bash
ln -s /etc/nginx/sites-available/fikirbingo.com /etc/nginx/sites-enabled/
rm /etc/nginx/sites-enabled/default  # Remove default site
nginx -t  # Test configuration
systemctl reload nginx
```

---

## Step 7: Setup SSL Certificate

```bash
# Get SSL certificate from Let's Encrypt
certbot --nginx -d fikirbingo.com -d www.fikirbingo.com

# Follow the prompts:
# - Enter your email address
# - Agree to terms
# - Choose whether to redirect HTTP to HTTPS (recommended: Yes)

# Auto-renewal is set up automatically
```

---

## Step 8: Start Backend with PM2

```bash
cd /var/www/fikirbingo/Bingo-Back

# Start the application
pm2 start ecosystem.config.js

# Save PM2 configuration
pm2 save

# Setup PM2 to start on system boot
pm2 startup
# Copy and run the command it outputs
```

---

## Step 9: Verify Everything Works

```bash
# Check PM2 status
pm2 status

# Check PM2 logs
pm2 logs love-bin

# Check Nginx status
systemctl status nginx

# Check if backend is running
curl http://localhost:3001/health

# Test from browser
# Visit: https://fikirbingo.com
```

---

## Step 10: Domain DNS Configuration

Make sure your domain DNS is pointing to the server:

1. Go to your domain registrar
2. Add/Update A record:
   - **Type**: A
   - **Name**: @ (or fikirbingo.com)
   - **Value**: 207.180.197.118
   - **TTL**: 3600

3. Add CNAME for www:
   - **Type**: CNAME
   - **Name**: www
   - **Value**: fikirbingo.com
   - **TTL**: 3600

Wait 5-30 minutes for DNS propagation.

---

## Useful Commands

### PM2 Commands
```bash
pm2 status              # Check status
pm2 logs                # View all logs
pm2 logs love-bin       # View specific app logs
pm2 restart love-bin    # Restart backend
pm2 stop love-bin      # Stop backend
pm2 monit               # Monitor in real-time
```

### Nginx Commands
```bash
nginx -t                # Test configuration
systemctl reload nginx  # Reload configuration
systemctl restart nginx # Restart nginx
systemctl status nginx  # Check status
```

### Update Frontend
```bash
cd /var/www/fikirbingo/FrontBingo
git pull  # If using git
# OR upload new files
npm run build
systemctl reload nginx
```

### Update Backend
```bash
cd /var/www/fikirbingo/Bingo-Back
git pull  # If using git
# OR upload new files
npm install
pm2 restart love-bin
```

---

## Troubleshooting

### Backend not starting?
```bash
cd /var/www/fikirbingo/Bingo-Back
pm2 logs love-bin --lines 50
# Check for errors in logs
```

### Nginx 502 Bad Gateway?
- Check if backend is running: `pm2 status`
- Check backend logs: `pm2 logs love-bin`
- Check nginx error logs: `tail -f /var/log/nginx/error.log`

### SSL Certificate Issues?
```bash
certbot certificates  # List certificates
certbot renew        # Renew certificates
```

### Port Already in Use?
```bash
netstat -tulpn | grep 3001  # Check what's using port 3001
# Kill process if needed
```

---

## Security Recommendations

1. **Change SSH Password** (after first login):
   ```bash
   passwd
   ```

2. **Setup SSH Key Authentication** (more secure than password)

3. **Keep System Updated**:
   ```bash
   apt update && apt upgrade -y
   ```

4. **Regular Backups**: Setup automated backups for your code and database

---

## Support

If you encounter issues:
1. Check PM2 logs: `pm2 logs`
2. Check Nginx logs: `tail -f /var/log/nginx/error.log`
3. Check system logs: `journalctl -xe`

---

## Next Steps

1. ✅ Complete all steps above
2. ✅ Test the application at https://fikirbingo.com
3. ✅ Monitor logs for the first few hours
4. ✅ Setup monitoring/alerting (optional)
5. ✅ Configure automatic backups (optional)

Good luck with your deployment! 🎉

