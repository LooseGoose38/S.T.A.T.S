// Import the dotenv package to read our hidden variables from the .env file
require('dotenv').config();

// Import the mongoose library to interact with our MongoDB database
const mongoose = require('mongoose');

// Import the Game blueprint we just created from the models folder
const Game = require('./models/Game');

// Import the Unlock blueprint we just created from the models folder
const Unlock = require('./models/Unlock');

// Create an asynchronous function so we can tell the code to "wait" for the database to respond
async function runTest() {
  
  // Use a try-catch block to handle any potential errors gracefully without crashing
  try {
    
    // Log a message to the console to show we are attempting to connect
    console.log('Connecting to database...');
    
    // Connect to MongoDB Atlas using the secure connection string
    await mongoose.connect(process.env.MONGO_URI);
    
    // Log a success message once the connection is established
    console.log('Connected!');

    // Create a new instance of a Game using our blueprint and Avatar data
    const testGame = new Game({
      
      // Set a fake external ID for the game
      externalGameId: 'UP0001-AVATAR',
      
      // Set the title of the game
      title: 'Avatar: Frontiers of Pandora',
      
      // Set the platform it was played on
      platform: 'PS5',
      
      // Set the ecosystem to PlayStation
      ecosystem: 'PlayStation',
      
      // Set the current progress object
      progress: {
        
        // Set unlocked count to 1 for this test
        unlockedCount: 1,
        
        // Set the total hypothetical trophies
        totalCount: 50,
        
        // Calculate a fake completion percentage
        completionPercentage: 2.0
        
      }
    });

    // Save the new game to the database and 'await' (pause) until it finishes
    const savedGame = await testGame.save();
    
    // Log that the game was saved successfully
    console.log('Test game saved to database!');

    // Create a new instance of an Unlock (a trophy) using our blueprint
    const testUnlock = new Unlock({
      
      // Link this unlock to the game we just saved using its unique, auto-generated MongoDB ID
      gameId: savedGame._id,
      
      // Duplicate the game title so our feed can read it easily later
      gameTitle: 'Avatar: Frontiers of Pandora',
      
      // Name the specific trophy
      achievementName: 'First Strike',
      
      // Provide a description for the trophy
      description: 'Completed your first mission.',
      
      // Set the date it was unlocked to the current exact time
      unlockDate: new Date(),

      iconUrl: 'https://example.com/fake-trophy-icon.png',
      
      // Define the weight and type of the trophy
      weight: {
        
        // Specify that this is a PlayStation Trophy
        type: 'Trophy',
        
        // Specify that it is a Bronze trophy
        value: 'Bronze'
        
      }
    });

    // Save the unlock to the database and 'await' (pause) until it finishes
    await testUnlock.save();
    
    // Log that the unlock was saved successfully
    console.log('Test unlock saved to database!');

  } catch (error) {
    
    // If anything goes wrong in the try block, log the error to the console
    console.error('An error occurred:', error);
    
  } finally {
    
    // Disconnect from the database so the script can finish running and exit
    await mongoose.disconnect();
    
    // Log that we have disconnected safely
    console.log('Disconnected from database. Test complete.');
    
  }
}

// Execute the asynchronous function we just built to run the test
runTest();