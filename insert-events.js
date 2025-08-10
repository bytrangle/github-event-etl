const redis = require('./client');
const fs = require('fs');
const path = require('path');
const { getCreatedAtKey, getEventStreamKey, getEventLogKey } = require('./redis-key-generator');

const luaScript = fs.readFileSync(path.join(__dirname, 'insert-events-into-db.lua'), 'utf8');

async function fetchPublicEvents() {
  try {    
    const headers = {
      'Accept': 'application/vnd.github+json',
      'User-Agent': 'oss-realtime-app'
    };
    
    // Add authorization header if GitHub token is available
    if (process.env.GITHUB_TOKEN) {
      headers['Authorization'] = `Bearer ${process.env.GITHUB_TOKEN}`;
    }
    
    const response = await fetch('https://api.github.com/events?per_page=100', {
      headers
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const events = await response.json();
    return events;
    
  } catch (error) {
    console.error('Error fetching GitHub events:', error.message);
  }
}

// Test database connection
// redis.set('last_tested_time', new Date().toISOString());
// redis.disconnect();

// // Run the function
fetchPublicEvents().then(async (res) => {
  const botPattern = /(\[bot\]|-bot$)/;
  const eventStreamKey = getEventStreamKey();
  try {
    // Process all events
    for (const event of res) {
      // Operation 1: Add event to the event stream
      // Filter out bot events
      if (event.actor && event.actor.display_login && botPattern.test(event.actor.display_login)) {
        console.log(`Skipping bot event: ${event.id}`);
        continue;
      }
      const eventLogKey = getEventLogKey(event.id);
      try {
        const result = await redis.eval(
          luaScript,
          2, // Number of keys (reduced from 3 to 2)
          eventStreamKey, // KEY[1],
          eventLogKey, // KEY[2]
          event.id, // ARGV[1]
          JSON.stringify(event), // ARGV[2]
          '1000'
        )
        console.log({ result });
        if (result === 0) {
          console.log(`Event ${event.id} already exists in the stream.`);
        } else {
          console.log(`Event ${event.id} inserted successfully.`);
        }
      } catch(error) {
        console.error(`Error inserting event: ${event.id}: `, error.message)
      }
    }
    
    // Set the created-at key only if it does not exist yet - after all events are processed
    await redis.set(getCreatedAtKey(), new Date().toISOString(), 'NX');
    console.log('Created at key set successfully');
    
  } catch (error) {
    console.error('Error processing events:', error);
  } finally {
    // Disconnect only after all operations are complete
    redis.disconnect();
  }
});