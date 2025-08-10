# GitHub Event ETL Pipeline

A Node.js ETL (Extract, Transform, Load) pipeline for processing GitHub public events using Redis streams and Lua scripts.

## Features

- **Real-time GitHub Events Processing**: Fetches and processes GitHub public events from the GitHub API
- **Redis Streams**: Uses Redis streams for efficient event storage with automatic trimming
- **Lua Scripts**: Atomic operations using Redis Lua scripts for data consistency
- **Developer Scoring**: Tracks developer activity with hourly scoring based on PushEvent and PullRequestEvent
- **Duplicate Prevention**: Prevents duplicate event processing using event log keys
- **Nested Object Flattening**: Automatically flattens complex JSON objects for Redis storage

## Architecture

### Components

1. **Event Fetcher** (`insert-events.js`): Fetches GitHub public events from the API
2. **Lua Script** (`insert-events-into-db.lua`): Handles atomic Redis operations
3. **Redis Client** (`client.js`): Redis connection configuration
4. **Key Generator** (`redis-key-generator.js`): Generates consistent Redis keys

### Data Flow

1. Fetch GitHub public events from API
2. For each event:
   - Check if event already exists (duplicate prevention)
   - Flatten nested objects (repo, actor, payload)
   - Store event in Redis stream with auto-generated ID
   - Update developer scores for PushEvent/PullRequestEvent
   - Mark event as processed with timestamp

## Redis Data Structure

### Keys Used

- `github-events:event-stream` - Redis stream containing all events
- `github-events:event-log:{eventId}` - Event processing status with created_at timestamp
- `github-events:dev-score:{YYYY-MM-DD-HH}` - Hourly developer activity scores
- `github-events:first-inserted-at` - Timestamp of first ETL run

### Event Stream Structure

Events are stored in Redis streams with flattened fields:

```
field: value
type: "PushEvent"
actor: '{"id":123,"login":"username","display_login":"username"}'
repo: '{"id":456,"name":"owner/repo"}'
payload: '{"commits":[...],"size":1}'
created_at: "2025-08-10T12:00:00Z"
```

## Setup

### Prerequisites

- Node.js 16+
- Redis instance
- GitHub API access (no authentication required for public events)

### Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/bytrangle/github-event-etl.git
   cd github-event-etl
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Configure Redis connection:
   Create a `.env` file with your Redis password:
   ```
   REDIS_PASSWORD=your_redis_password
   ```

4. Update Redis connection details in `client.js` if needed

### Usage

Run the ETL pipeline:

```bash
npm start
```

The script will:
- Fetch up to 100 recent GitHub public events
- Process and store them in Redis
- Update developer activity scores
- Handle duplicates automatically
- Display processing results

## Configuration

### Stream Trimming

The Redis stream is automatically trimmed to maintain approximately 1000 events. Modify the `maxlen` parameter in the Lua script to change this limit.

### Event Types for Developer Scoring

Currently tracks:
- `PushEvent` - Code pushes
- `PullRequestEvent` - Pull request activities

Modify the Lua script to include additional event types.

### Time Partitioning

Developer scores are partitioned by hour (YYYY-MM-DD-HH format) for time-based analytics.

## Error Handling

- Network errors during GitHub API calls are logged and handled gracefully
- Redis connection errors are caught and reported
- Duplicate events are skipped (returns 0 from Lua script)
- Invalid JSON data is handled in the Lua script

## Performance Considerations

- Uses Redis Lua scripts for atomic operations
- Processes events sequentially to maintain order
- Auto-generates Redis stream IDs for monotonic ordering
- Implements connection cleanup in finally blocks

## Monitoring

The pipeline provides detailed logging:
- Event processing results
- Duplicate detection
- Error messages with event IDs
- Connection status

## Redis Commands for Monitoring

### View Recent Events in Stream
```bash
XREAD COUNT 10 STREAMS github-events:event-stream 0
```

### Check Developer Scores (Current Hour)
```bash
ZREVRANGE github-events:dev-score:2025-08-10-12 0 9 WITHSCORES
```

### View Event Processing Status
```bash
GET github-events:event-log:{eventId}
```

### Stream Information
```bash
XINFO STREAM github-events:event-stream
```

## File Structure

```
├── README.md                    # This file
├── package.json                 # Node.js dependencies and scripts
├── client.js                    # Redis client configuration
├── insert-events.js             # Main ETL pipeline script
├── insert-events-into-db.lua    # Lua script for atomic Redis operations
├── redis-key-generator.js       # Redis key management utilities
├── .gitignore                   # Git ignore rules
└── .env                         # Environment variables (create this)
```

## Example Output

When running the pipeline, you'll see output like:

```
{ result: 1 }
Event 42345678901 inserted successfully.
{ result: 0 }
Event 42345678902 already exists in the stream.
Created at key set successfully
```

## Troubleshooting

### Common Issues

1. **"Connect is closed" error**: Ensure Redis connection details are correct in `client.js`
2. **"Invalid stream ID" error**: This should be resolved as the script uses auto-generated IDs
3. **Network timeouts**: Check your internet connection for GitHub API access

### Debug Mode

Add console.log statements in the Lua script or JavaScript code to debug specific issues.

## License

MIT

## Contributing

Contributions are welcome! Please feel free to submit pull requests or open issues for improvements.

### Development Setup

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test with your Redis instance
5. Submit a pull request

## Roadmap

- [ ] Add support for more GitHub event types
- [ ] Implement real-time event streaming
- [ ] Add web dashboard for monitoring
- [ ] Support for multiple Redis clusters
- [ ] Add unit tests
- [ ] Docker containerization
