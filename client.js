// export default client;
require ('dotenv').config();
const Redis = require('ioredis');
const redis = new Redis({
  port: 12517, // Redis port
  host: 'redis-12517.c322.us-east-1-2.ec2.redns.redis-cloud.com', // Redis host
  username: 'default', // Redis username
  password: process.env.REDIS_PASSWORD, // Replace
});

module.exports = redis;