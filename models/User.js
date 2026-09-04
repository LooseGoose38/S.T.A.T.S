const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    username:{ 
        type: String,
        required: true,
        uniqie: true
    },
    password: {
        type: String,
        required: true
    },
    psnId: {
        type: String,
        required: true
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

module.exports = mongoose.model('User', userSchema);