const PREFIX = 'github-events'
const getKey = key => `${PREFIX}:${key}`;
const getCreatedAtKey = () => getKey(`first-inserted-at`);
const getEventStreamKey = () => getKey('event-stream');
const getEventLogKey = (eventId) => getKey(`event-log:${eventId}`);
const getRepoScoreKey = () => getKey(`repo-score`);
const getDevScoreKey = () => {
  const now = new Date();
  const dateString = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}-${now.getHours()}`;
  return getKey(`dev-score:${dateString}`);
}

module.exports = {
  getEventStreamKey,
  getKey,
  getDevScoreKey,
  getRepoScoreKey,
  getCreatedAtKey,
  getEventLogKey
};