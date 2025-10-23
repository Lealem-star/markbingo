module.exports = {
    apps: [{
        name: 'love-bingo-bot',
        script: 'index.js',
        instances: 1,
        autorestart: true,
        watch: false,
        max_memory_restart: '1G',
        env: {
            NODE_ENV: 'production',
            PORT: 3001
        },
        error_file: './logs/err.log',
        out_file: './logs/out.log',
        log_file: './logs/combined.log',
        time: true,
        kill_timeout: 5000,
        wait_ready: true,
        listen_timeout: 10000,
        max_restarts: 10,
        min_uptime: '10s',
        restart_delay: 4000
    }]
};
