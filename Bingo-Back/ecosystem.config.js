module.exports = {
    apps: [
        // API (backend) process
        {
            name: 'love-bin',
            script: './index.js',
            instances: 1,
            autorestart: true,
            watch: false,
            max_memory_restart: '1G',
            env: {
                NODE_ENV: 'production',
                PORT: 3001,
                BOT_TOKEN: '7879034950:AAFNKagUiLIBVRgmAPj9czto328dYh72TB8',
                RUN_TELEGRAM_BOT: 'false',
                ADMIN_BOOT_CODE: 'SuperSecret2018',
                WEBAPP_URL: 'https://fikirbingo.com',
                API_BASE_URL: 'https://fikirbingo.com',
                JWT_SECRET: 'your_super_secret_jwt_key_here_change_this',
                MONGODB_URI: 'mongodb+srv://meseretlealem8_db_user:PF1ruEYjsSW3T5ak@bingo1.drzbzl7.mongodb.net/?retryWrites=true&w=majority&appName=bingo1',
                AGENT_PHONE_NUMBERS: '127',
                AGENT_SERVICES: 'CBEBirr,CBE',
                SMS_WEBHOOK_SECRET: 'i_secreted_lealem'
            },
            error_file: './logs/api-err.log',
            out_file: './logs/api-out.log',
            time: true,
            kill_timeout: 5000,
            wait_ready: true,
            listen_timeout: 10000,
            max_restarts: 10,
            min_uptime: '10s',
            restart_delay: 4000
        },
        // Telegram bot process
        {
            name: 'love-bingo-bot',
            script: './telegram/bot.js',
            instances: 1,
            autorestart: true,
            watch: false,
            max_memory_restart: '512M',
            env: {
                NODE_ENV: 'production',
                BOT_TOKEN: '7879034950:AAFNKagUiLIBVRgmAPj9czto328dYh72TB8',
                RUN_TELEGRAM_BOT: 'true',
                WEBAPP_URL: 'https://fikirbingo.com',
                API_BASE_URL: 'http://localhost:3001',
                MONGODB_URI: 'mongodb+srv://meseretlealem8_db_user:PF1ruEYjsSW3T5ak@bingo1.drzbzl7.mongodb.net/?retryWrites=true&w=majority&appName=bingo1'
            },
            error_file: './logs/bot-err.log',
            out_file: './logs/bot-out.log',
            time: true,
            kill_timeout: 5000,
            wait_ready: true,
            listen_timeout: 10000,
            max_restarts: 10,
            min_uptime: '10s',
            restart_delay: 4000
        }
    ]
};
