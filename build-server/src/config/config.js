const dotenv = require('dotenv');
const path = require('path');

// Load environment variables
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const config = {
  aws: {
    region: process.env.AWS_REGION,
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    s3BucketName: process.env.S3_BUCKET_NAME
  },
  kafka: {
    clientId: process.env.KAFKA_CLIENT_ID,
    broker: process.env.KAFKA_BROKER,
    sasl: {
      username: process.env.SASL_USERNAME,
      password: process.env.SASL_PASSWORD,
      mechanism: process.env.SASL_MECHANISM
    }
  },
  clickhouse: {
    host: process.env.CLICKHOUSE_HOST,
    database: process.env.CLICKHOUSE_DB,
    username: process.env.CLICKHOUSE_USER,
    password: process.env.CLICKHOUSE_PASSWORD
  },
  project: {
    uri: process.env.PROJECT_URI,
    deploymentId: process.env.DEPLOYMENT_ID,
    installCommand: process.env.PROJECT_INSTALL_COMMAND,
    buildCommand: process.env.PROJECT_BUILD_COMMAND,
    rootDir: process.env.PROJECT_ROOT_DIR
  }
};

// Validate required configuration for build server
const validateConfig = () => {
  const requiredFields = [
    'aws.region',
    'aws.accessKeyId',
    'aws.secretAccessKey',
    'aws.s3BucketName',
    'project.uri',
    'project.deploymentId',
    'project.installCommand',
    'project.buildCommand'
  ];

  for (const field of requiredFields) {
    const value = field.split('.').reduce((obj, key) => obj?.[key], config);
    if (!value) {
      throw new Error(`Missing required configuration: ${field}`);
    }
  }
};

validateConfig();

module.exports = config;