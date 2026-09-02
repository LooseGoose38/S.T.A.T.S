const mongoose = require('mongoose');

const achievementSchema = new mongoose.Schema({
    gameId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Game',
        required: true
    },
    gameTitle: {type: String, required: true },
    achievementName: { type: String, required: true },
    description: { type: String, required: true },
    iconUrl: { type: String, required: true },

    isUnlocked: { type: Boolean, default: false },

    unlockDate: { type: Date },

    weight: {
        type: { type: String, required: true },
        value: { type: String, required: true },
        isRare: { type: Boolean, default: false }
    }
});

module.exports = mongoose.model('Achievement', achievementSchema);