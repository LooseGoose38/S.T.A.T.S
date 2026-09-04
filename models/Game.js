const mongoose = require('mongoose');

const gameSchema = new mongoose.Schema({
    userId: { type: String, required: true },        
    externalGameId: { type: String, required: true }, 
    title: String,
    platform: String,
    ecosystem: String,
    boxArtUrl: String,
    progress: {
        unlockedCount: Number,
        totalCount: Number,
        completionPercentage: Number
    },
    lastPlayed: Date
});

module.exports = mongoose.model('Game', gameSchema);