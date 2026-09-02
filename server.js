require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

//import blueprints
const Game = require('./models/Game');
const Achivement = require('./models/Achievement');

const app = express();
const PORT = 3000;

app.use(cors()); // lets web browser fetch data
app.use(express.json()); // tells server to use JSON

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
        .sort({ unlockedDate: -1 })
        .limit(50)

        res.json(feed);
    } catch (error){
        res.status(500).json({ error: 'failed to fetch feed'});
    }
});

//start server
app.listen(PORT, () => {
    console.log(`Server is live and listening on http://localhost:${PORT}`);
});