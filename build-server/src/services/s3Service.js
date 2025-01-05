const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const config = require('../config/config');
const mime = require('mime-types');
const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

class S3Service {
  constructor() {
    this.client = new S3Client({
      region: config.aws.region,
      credentials: {
        accessKeyId: config.aws.accessKeyId,
        secretAccessKey: config.aws.secretAccessKey
      }
    });
  }

  async uploadFile(filePath, projectUri) {
    const fileStream = fs.createReadStream(filePath);
    const fileName = path.basename(filePath);
    
    const command = new PutObjectCommand({
      Bucket: config.aws.s3BucketName,
      Key: `__outputs/${projectUri}/${fileName}`,
      Body: fileStream,
      ContentType: mime.lookup(filePath) || 'application/octet-stream'
    });

    try {
      await this.client.send(command);
      logger.info(`Successfully uploaded ${fileName}`);
    } catch (error) {
      logger.error(`Failed to upload ${fileName}: ${error.message}`);
      throw error;
    }
  }
}

module.exports = new S3Service();