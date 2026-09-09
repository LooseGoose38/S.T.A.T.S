const mongoose = require('mongoose');

const achievementSchema = new mongoose.Schema({
    userId: { type: String, required: true },
    gameId: { type: mongoose.Schema.Types.ObjectId, ref: 'Game' },
    gameTitle: String,
    achievementName: String,
    description: String,
    iconUrl: String,
    isUnlocked: { type: Boolean, default: false },
    unlockDate: Date,
    weight: {
        type: { type: String },
        value: { type: String },
        isRare: { type: Boolean, default: false },
        earnedRate: { type: Number } //stores rarity percentage
    },
    guideHtml: {
        type: String,
        default: ''
    },
    trophyGroupId: {
        type: String,
        default: 'default'
    }
});

module.exports = mongoose.model('Achievement', achievementSchema);