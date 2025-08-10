local eventStreamKey = KEYS[1]
local eventLogKey = KEYS[2]
local devScoreKey = KEYS[3]
local eventId = ARGV[1]
local eventDataJSON = ARGV[2]
local maxlen = tonumber(ARGV[3]) or 1000

-- Check if event log key exists
local existingEventLog = redis.call('GET', eventLogKey)
if existingEventLog then
  return 0 -- Event already exists, skip
end

-- Lua scripts can only receive strings as arguments, so we need to parse them
local eventData = cjson.decode(eventDataJSON)

-- Function to flatten nested objects
local function flattenValue(value)
  if type(value) == "table" then
    return cjson.encode(value)
  else
    return tostring(value)
  end
end

-- Build field-value pairs for XADD with flattening
local xaddFields = {}
for key, value in pairs(eventData) do
  table.insert(xaddFields, key)
  table.insert(xaddFields, flattenValue(value))
end

-- Add event to stream with trimming (using auto-generated ID)
redis.call('XADD', eventStreamKey, 'MAXLEN', '~', maxlen, '*', unpack(xaddFields))

-- Set the event log key to mark the event as processed with created_at timestamp
local eventLogData = {
  created_at = eventData.created_at
}
redis.call('SET', eventLogKey, cjson.encode(eventLogData))

-- Check if event type is PushEvent or PullRequestEvent for dev scoring
local eventType = eventData.type
if eventType == 'PushEvent' or eventType == 'PullRequestEvent' then
  local displayLogin = eventData.actor and eventData.actor.display_login
  if displayLogin then
    redis.call('ZINCRBY', devScoreKey, 1, displayLogin)
  end
end

return 1