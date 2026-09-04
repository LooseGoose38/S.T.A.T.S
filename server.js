require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');

//import blueprints
const Game = require('./models/Game');
const Achievement = require('./models/Achievement');

const app = express();

const PORT = process.env.PORT || 3000;

app.use(cors()); // lets web browser fetch data
app.use(express.json()); // tells server to use JSON

app.use(express.static(path.join(__dirname, 'frontend')));

//connect to MongoDB
mongoose.connect(process.env.MONGO_URI)
.then (() => console.log('connected to MongoDB Atlas'))
.catch (err => console.error('database error:', err));

//API EndPoints
//game library endpoint
//pinging this URL returns all games, sorted by last time played
app.get('/api/games', async (req, res) =>{
    try{
        const games = await Game.find().sort({ lastPlayed: -1 });
        res.json(games);
    } catch (error){
        res.status(500).json({ error: 'failed to fetch games' });
    }
});

//unified achievement feed endpoint
//pinging the URL retruns 50 most recent unlocked achievements
app.get('/api/feed', async (req, res) => {
    try{
        const feed = await Achievement.find({ isUnlocked: true })
        .sort({ unlockDate: -1 })
        .limit(50)

        res.json(feed);
    } catch (error){
        res.status(500).json({ error: 'failed to fetch feed'});
    }
});

app.get('/api/games/:id', async (req, res) => {
    try{
        const game = await Game.findById(req.params.id);
        res.json(game);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch game details'});
    }
});

app.get('/api/games/:id/achievements', async (req, res) => {
    try{
        const achievements = await Achievement.find({ gameId: req.params.id })
        .sort({ isUnlocked: -1, unlockDate: -1 });
        res.json(achievements);
    } catch (error){
        res.status(500).json({ error: 'failed to fetch achievements'});
    }
})

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('./models/User');

//registration endpoint
app.post('/api/auth/register', async (req, res) => {
    try{
    //check if the username has been taken
    let existingUser = await User.findOne({ username });
    if(existingUser){
        return res.status(400).json({ message: 'Username is already taken'});
    }


    //hash the password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    const newUser = new User({
        username: username,
        password: hashedPassword,
        psnId: psnId
    });

    await newUser.save();
    res.status(201).json({ message: 'User registered successfully'})
} catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ message: 'Server error during registration.' });
}
});


//start server
app.listen(PORT, () => {
    console.log(`Server is live and listening on http://localhost:${PORT}`);
});