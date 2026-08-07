const mongoose = require('mongoose');

const connectDB = async () => {
    try {
        const mongoURI = process.env.MONGODB_URI || 'mongodb+srv://meseretlealem8_db_user:qQcXeixRvjx3v8ge@besttest.ckemna6.mongodb.net/?appName=besttest';

        const conn = await mongoose.connect(mongoURI, {
            serverSelectionTimeoutMS: 30000, // Increased to 30s for better reliability
            socketTimeoutMS: 45000, // Close sockets after 45 seconds of inactivity
            connectTimeoutMS: 30000, // Connection timeout
            maxPoolSize: 10, // Maintain up to 10 socket connections
            minPoolSize: 2, // Maintain at least 2 socket connections
            maxIdleTimeMS: 30000, // Close connections after 30 seconds of inactivity
            heartbeatFrequencyMS: 10000, // Check connection health every 10 seconds
            retryWrites: true, // Retry write operations
            retryReads: true, // Retry read operations
        });

        console.log(`🗄️  MongoDB Connected: ${conn.connection.host}`);

        // Handle connection events
        mongoose.connection.on('error', (err) => {
            console.error('❌ MongoDB connection error:', err);
        });

        mongoose.connection.on('disconnected', () => {
            console.log('⚠️  MongoDB disconnected - attempting to reconnect...');
            // Auto-reconnect is handled by mongoose by default
        });

        mongoose.connection.on('reconnected', () => {
            console.log('✅ MongoDB reconnected');
        });

        mongoose.connection.on('connecting', () => {
            console.log('🔄 MongoDB connecting...');
        });

        // Graceful shutdown
        process.on('SIGINT', async () => {
            await mongoose.connection.close();
            console.log('🔌 MongoDB connection closed through app termination');
            process.exit(0);
        });

    } catch (error) {
        console.error('❌ MongoDB connection failed:', error.message);
        // Don't exit - throw error so caller can handle it
        throw error;
    }
};

module.exports = connectDB;
