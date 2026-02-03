const mongoose = require('mongoose');
const CartellaSelection = require('./models/CartellaSelection');

// Migration script to convert in-memory cartella selections to database
async function migrateCartellaSelections() {
    try {
        console.log('🔄 Starting cartella selections migration...');

        // Connect to database
        const mongoURI = process.env.MONGODB_URI || 'mongodb://localhost:27017/fun-bingo';
        await mongoose.connect(mongoURI);
        console.log('✅ Connected to MongoDB');

        // Check if there are any existing cartella selections
        const existingCount = await CartellaSelection.countDocuments();
        console.log(`📊 Found ${existingCount} existing cartella selections in database`);

        if (existingCount > 0) {
            console.log('⚠️  Database already contains cartella selections. Migration skipped.');
            console.log('💡 If you want to reset, run: await CartellaSelection.deleteMany({})');
            return;
        }

        // If you have existing in-memory data, you can migrate it here
        // For example, if you have a backup or want to seed some test data:

        const sampleSelections = [
            {
                cartellaNumber: 1,
                playerId: null, // anonymous
                playerName: 'Test Player 1',
                stake: 10,
                gameId: 'test_game_1',
                status: 'selected',
                selectedAt: new Date(Date.now() - 300000) // 5 minutes ago
            },
            {
                cartellaNumber: 2,
                playerId: null, // anonymous
                playerName: 'Test Player 2',
                stake: 50,
                gameId: 'test_game_1',
                status: 'confirmed',
                selectedAt: new Date(Date.now() - 600000), // 10 minutes ago
                confirmedAt: new Date(Date.now() - 300000) // 5 minutes ago
            }
        ];

        // Insert sample data (optional)
        if (process.env.MIGRATE_SAMPLE_DATA === 'true') {
            console.log('📝 Inserting sample cartella selections...');
            await CartellaSelection.insertMany(sampleSelections);
            console.log(`✅ Inserted ${sampleSelections.length} sample selections`);
        }

        // Create indexes for better performance
        console.log('🔧 Creating database indexes...');
        await CartellaSelection.createIndexes();
        console.log('✅ Indexes created successfully');

        // Verify migration
        const finalCount = await CartellaSelection.countDocuments();
        console.log(`📊 Migration complete! Total cartella selections: ${finalCount}`);

        // Show some statistics
        const stats = await CartellaSelection.aggregate([
            {
                $group: {
                    _id: '$status',
                    count: { $sum: 1 },
                    totalStake: { $sum: '$stake' }
                }
            }
        ]);

        console.log('📈 Current statistics:');
        stats.forEach(stat => {
            console.log(`   ${stat._id}: ${stat.count} selections, total stake: ${stat.totalStake}`);
        });

    } catch (error) {
        console.error('❌ Migration failed:', error);
        throw error;
    } finally {
        await mongoose.connection.close();
        console.log('🔌 Database connection closed');
    }
}

// Run migration if this file is executed directly
if (require.main === module) {
    migrateCartellaSelections()
        .then(() => {
            console.log('🎉 Migration completed successfully!');
            process.exit(0);
        })
        .catch((error) => {
            console.error('💥 Migration failed:', error);
            process.exit(1);
        });
}

module.exports = migrateCartellaSelections;
