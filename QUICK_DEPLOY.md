# ⚡ Quick Deployment Reference

## Server Access
```bash
ssh root@207.180.197.118
# Password: SHu18Q36
```

## One-Time Server Setup
```bash
# Run the setup script
chmod +x setup-server.sh
./setup-server.sh
```

## Upload Code (Choose one method)

### Method 1: SCP (from your local machine)
```bash
# Backend
scp -r Bingo-Back root@207.180.197.118:/var/www/fikirbingo/

# Frontend  
scp -r FrontBingo root@207.180.197.118:/var/www/fikirbingo/
```

### Method 2: WinSCP (Windows GUI)
- Download: https://winscp.net/
- Connect: `207.180.197.118` | `root` | `SHu18Q36`
- Upload folders to `/var/www/fikirbingo/`

## Backend Setup
```bash
cd /var/www/fikirbingo/Bingo-Back
npm install
mkdir -p logs
pm2 start ecosystem.config.js
pm2 save
pm2 startup  # Follow instructions
```

## Frontend Build
```bash
cd /var/www/fikirbingo/FrontBingo
npm install
npm run build
```

## Nginx Configuration
```bash
# Copy config file
cp nginx-config.conf /etc/nginx/sites-available/fikirbingo.com

# Enable site
ln -s /etc/nginx/sites-available/fikirbingo.com /etc/nginx/sites-enabled/
rm /etc/nginx/sites-enabled/default

# Test and reload
nginx -t
systemctl reload nginx
```

## SSL Certificate
```bash
certbot --nginx -d fikirbingo.com -d www.fikirbingo.com
```

## Verify Deployment
```bash
# Check PM2
pm2 status
pm2 logs love-bin

# Check Nginx
systemctl status nginx

# Test backend
curl http://localhost:3001/health

# Visit in browser
# https://fikirbingo.com
```

## Common Commands

### Restart Backend
```bash
cd /var/www/fikirbingo/Bingo-Back
pm2 restart love-bin
```

### Update Frontend
```bash
cd /var/www/fikirbingo/FrontBingo
npm run build
systemctl reload nginx
```

### View Logs
```bash
pm2 logs love-bin        # Backend logs
tail -f /var/log/nginx/error.log  # Nginx errors
```

## DNS Configuration
Make sure your domain DNS has:
- **A Record**: `@` → `207.180.197.118`
- **CNAME**: `www` → `fikirbingo.com`

Wait 5-30 minutes for DNS propagation.

