const dotenv = require('dotenv');
const path = require('path');

const envPath = path.resolve(process.cwd(), '.env');
const envConfig = dotenv.config({ path: envPath }).parsed || {};

module.exports = {
  port: process.env.PORT || 8000,
  basePath: envConfig.BASE_PATH,
  cors: {
    origin: '*',
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    allowedHeaders: 'Content-Type,Authorization'
  }
};