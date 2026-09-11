require('dotenv').config();
const mongoose = require('mongoose');

//connect MongoDB Atlas
mongoose.connect(process.env.MONGO_URI)
.then(() => console.log('Successfully connected to MongoDB'))
.catch((error) => console.error('Error connecting to MongoDB', error));