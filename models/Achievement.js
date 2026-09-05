const mongoose = require('mongoose');

const achievementSchema = new mongoose.Schema({
    userId: { type: String, required: true },
    gameId: { type: mongoose.Schema.Types.ObjectId, ref: 'Game' },
    gameTitle: String,
    achievementName: String,
    description: String,
    iconUrl: String,
    isUnlocked: Boolean,
    unlockDate: Date,
    weight: {
        type: { type: String },
        value: String,
        isRare: Boolean
    },
    guideHtml: {
        type: String,
        default: ''
    }
});

module.exports = mongoose.model('Achievement', achievementSchema);