const mongoose = require('mongoose')

const gameSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    title: { type: String, required: true },
    platform: { type: String, required: true },
    ecosystem: { type: String, required: true },
    boxArtUrl: { type: String },
    progress: {
        unlockedCount: { type: Number, default: 0 },
        totalCount: { type: Number, default: 0 },
        completionPercentage: { type: Number, default: 0 }
    },
    lastPlayed: { type: Date }
});

module.exports = mongoose.model('Game', gameSchema);