const { Kafka, Partitioners } = require('kafkajs');
const config = require('../config/config');
const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

class KafkaService {
  constructor() {
    this.kafka = new Kafka({
      clientId: config.kafka.clientId,
      brokers: [config.kafka.broker],
      ssl: {
        ca: [fs.readFileSync(path.join(__dirname, '../../ca.pem'), 'utf-8')],
        rejectUnauthorized: true
      },
      sasl: {
        username: config.kafka.sasl.username,
        password: config.kafka.sasl.password,
        mechanism: config.kafka.sasl.mechanism
      }
    });

    this.producer = null;
  }

  async connect() {
    try {
      this.producer = this.kafka.producer({
        createPartitioner: Partitioners.LegacyPartitioner
      });
      await this.producer.connect();
    } catch (error) {
      logger.error('Failed to connect to Kafka:', error);
      throw error;
    }
  }

  async publishLog(log) {
    if (!this.producer) {
      throw new Error('Kafka producer not initialized');
    }

    try {
      await this.producer.send({
        topic: 'build-logs',
        messages: [{
          key: 'log',
          value: JSON.stringify({
            PROJECT_URI: config.project.uri,
            DEPLOYMENT_ID: config.project.deploymentId,
            log
          })
        }]
      });
    } catch (error) {
      logger.error('Failed to publish log:', error);
      throw error;
    }
  }

  async disconnect() {
    if (this.producer) {
      await this.producer.disconnect();
    }
  }
}

module.exports = new KafkaService();