const redis = require('./client');
const fs = require('fs');
const path = require('path');
const { pipeline } = require('stream');
const { promisify } = require('util');
const zlib = require('zlib');
const readline = require('readline');

const pipelineAsync = promisify(pipeline);

// Get today's date in ISO format (YYYY-MM-DD) in UTC
function getTodayISO() {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  const day = String(now.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// Get last complete hour (current hour - 1) in UTC
function getLastHour() {
  const now = new Date();
  const lastHour = now.getUTCHours() - 1;
  return lastHour < 0 ? -1 : lastHour; // Return -1 if negative to indicate skip
}

// Generate Redis key for dev score
function getDevScoreKey(date, hour) {
  return `github-events:contributor-score:${date}:${hour}`;
}

// Get Unix timestamp for midnight of the next day
function getNextMidnightUnixTimestamp() {
  const now = new Date();
  const nextDay = new Date(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0, 0);
  return Math.floor(nextDay.getTime() / 1000);
}

// Check if actor is a bot based on login name patterns
function isBotActor(login) {
  if (!login) return true; // Filter out null/undefined logins
  
  const lowerLogin = login.toLowerCase();
  
  // Check for various bot patterns
  return (
    lowerLogin.includes('[bot]') ||           // GitHub app bots like dependabot[bot]
    lowerLogin.endsWith('-bot') ||            // Names ending with -bot
    lowerLogin.endsWith('bot') ||             // Names ending with bot
    lowerLogin.startsWith('aws') ||           // AWS bots
    lowerLogin.includes('copilot') ||         // GitHub Copilot
    lowerLogin.includes('renovate') ||        // Renovate bot
    lowerLogin.includes('greenkeeper') ||     // Greenkeeper bot
    lowerLogin.includes('snyk') ||            // Snyk bot
    lowerLogin.includes('security') ||        // Security bots
    lowerLogin.includes('automation') ||      // Automation accounts
    lowerLogin.includes('deploy') ||          // Deploy bots
    lowerLogin.includes('ci-') ||             // CI bots
    lowerLogin.includes('-ci') ||             // CI bots
    lowerLogin.includes('build') ||           // Build bots
    lowerLogin.includes('release')            // Release bots
  );
}

// Download and extract .gz file
async function downloadAndExtract(url, outputPath) {
  console.log(`Downloading: ${url}`);
  
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    // Create write stream and gunzip transform
    const writeStream = fs.createWriteStream(outputPath);
    const gunzip = zlib.createGunzip();
    
    // Pipeline: response -> gunzip -> file
    await pipelineAsync(
      response.body,
      gunzip,
      writeStream
    );

    console.log(`Downloaded and extracted: ${outputPath}`);
  } catch (error) {
    console.error(`Error downloading ${url}:`, error.message);
    throw error;
  }
}

// Process events from a JSON file
async function processEventsFile(filePath, date, hour) {
  console.log(`Processing events from: ${filePath}`);
  
  const devScoreKey = getDevScoreKey(date, hour);
  const fileStream = fs.createReadStream(filePath);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });

  let processedCount = 0;
  let scoredCount = 0;
  
  // Create pipeline for batching Redis operations
  const pipeline = redis.pipeline();
  const batchSize = 1000; // Process in batches of 1000
  let batchCount = 0;
  let keyExpirationSet = false; // Track if we've set expiration for this key
  const expireAtTimestamp = getNextMidnightUnixTimestamp();

  for await (const line of rl) {
    try {
      const event = JSON.parse(line);
      processedCount++;

      // Check if event type is PushEvent or PullRequestEvent
      if (event.type === 'PushEvent' || event.type === 'PullRequestEvent') {
        // Get actor login name
        const actorLogin = event.actor?.login;
        
        // Filter out bot actors
        if (actorLogin && !isBotActor(actorLogin)) {
          // Add to pipeline instead of executing immediately
          pipeline.zincrby(devScoreKey, 1, actorLogin);
          
          // Set expiration only once per key
          if (!keyExpirationSet) {
            pipeline.expireat(devScoreKey, expireAtTimestamp);
            keyExpirationSet = true;
          }
          
          scoredCount++;
          batchCount++;
          
          // Execute pipeline when batch size is reached
          if (batchCount >= batchSize) {
            await pipeline.exec();
            console.log(`Processed ${scoredCount} scoring events from ${filePath}`);
            batchCount = 0;
          }
        }
      }
    } catch (error) {
      console.error(`Error parsing event line:`, error.message);
      // Continue processing other lines
    }
  }
  
  // Execute remaining operations in pipeline
  if (batchCount > 0) {
    await pipeline.exec();
  }

  console.log(`Finished processing ${filePath}: ${processedCount} events, ${scoredCount} scored`);
  return { processedCount, scoredCount };
}

// Main function to process GitHub Archive data
async function processGitHubArchive() {
  const today = getTodayISO();
  const lastHour = getLastHour();
  
  // Skip processing if lastHour is negative (UTC hour 0)
  if (lastHour < 0) {
    console.log(`Skipping processing: It's currently UTC hour 0, no complete hours to process yet.`);
    await redis.disconnect();
    return;
  }
  
  console.log(`Processing GitHub Archive data for ${today}, hours 0-${lastHour} (UTC)`);

  const tempDir = path.join(__dirname, 'temp');
  
  // Create temp directory if it doesn't exist
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir);
  }

  let totalProcessed = 0;
  let totalScored = 0;

  try {
    // Process each hour from lastHour down to 0
    // If we find an existing key, we can break since earlier hours are already processed
    for (let hour = lastHour; hour >= 0; hour--) {
      const devScoreKey = getDevScoreKey(today, hour);
      
      // Check if this hour has already been processed
      const keyExists = await redis.exists(devScoreKey);
      if (keyExists) {
        console.log(`Hour ${hour} already processed (key ${devScoreKey} exists)`);
        console.log(`Breaking loop - hours 0-${hour} have been processed`);
        break;
      }
      
      const hourStr = String(hour);
      const filename = `${today}-${hourStr}.json`;
      const url = `https://data.gharchive.org/${today}-${hourStr}.json.gz`;
      const tempFilePath = path.join(tempDir, filename);

      try {
        // Download and extract the file
        await downloadAndExtract(url, tempFilePath);

        // Process events from the file
        const result = await processEventsFile(tempFilePath, today, hour);
        // Set expiration AFTER processing is complete
        const expireAtTimestamp = getNextMidnightUnixTimestamp();
        await redis.expireat(devScoreKey, expireAtTimestamp);
        console.log(`Set expiration for ${devScoreKey} at midnight`);
        totalProcessed += result.processedCount;
        totalScored += result.scoredCount;

        // Clean up temp file
        fs.unlinkSync(tempFilePath);
        console.log(`Cleaned up temp file: ${tempFilePath}`);

      } catch (error) {
        console.error(`Error processing hour ${hour}:`, error.message);
        // Continue with next hour
      }
    }

    console.log(`\n=== Processing Complete ===`);
    console.log(`Total events processed: ${totalProcessed}`);
    console.log(`Total events scored: ${totalScored}`);
    console.log(`Date: ${today}`);
    console.log(`Hours processed: 0-${lastHour}`);

    // Create daily summary using ZUNIONSTORE
    console.log(`\n=== Creating Daily Summary ===`);
    const summaryKey = `github-events:contributor-score:${today}:sum`;
    const hourlyKeys = [];
    
    // Collect all hourly keys that were processed
    for (let hour = 0; hour <= lastHour; hour++) {
      hourlyKeys.push(getDevScoreKey(today, hour));
    }
    
    // Use ZUNIONSTORE to combine all hourly scores
    const numKeys = hourlyKeys.length;
    await redis.zunionstore(summaryKey, numKeys, ...hourlyKeys);
    
    // Set expiration for the summary key to midnight of next day
    const summaryExpireAt = getNextMidnightUnixTimestamp();
    await redis.expireat(summaryKey, summaryExpireAt);
    
    console.log(`Created daily summary at key: ${summaryKey}`);
    console.log(`Combined ${numKeys} hourly score sets`);
    console.log(`Summary key expires at: ${new Date(summaryExpireAt * 1000).toISOString()}`);

  } catch (error) {
    console.error('Error in main processing:', error.message);
  } finally {
    // Clean up temp directory
    try {
      if (fs.existsSync(tempDir)) {
        const files = fs.readdirSync(tempDir);
        for (const file of files) {
          fs.unlinkSync(path.join(tempDir, file));
        }
        fs.rmdirSync(tempDir);
        console.log('Cleaned up temp directory');
      }
    } catch (cleanupError) {
      console.error('Error cleaning up:', cleanupError.message);
    }

    // Close Redis connection
    await redis.disconnect();
  }
}

processGitHubArchive().catch(console.error);
