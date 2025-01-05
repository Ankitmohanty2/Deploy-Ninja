const { createClient } = require('@clickhouse/client');
const config = require('../config/config');
const logger = require('../utils/logger');
const { BuildError, ErrorHandler } = require('../utils/errorHandler');

class ClickHouseService {
  constructor() {
    this.client = createClient({
      host: config.clickhouse.host,
      username: config.clickhouse.username,
      password: config.clickhouse.password,
      database: config.clickhouse.database
    });

    this.isConnected = false;
  }

  async initialize() {
    try {
      // Test connection
      await this.client.ping();
      this.isConnected = true;
      logger.info('ClickHouse connection established');

      // Ensure required tables exist
      await this.createTablesIfNotExist();
    } catch (error) {
      throw new BuildError(
        'Failed to initialize ClickHouse connection',
        ErrorHandler.BUILD_ERROR_CODES.CLICKHOUSE_ERROR,
        { originalError: error.message }
      );
    }
  }

  async createTablesIfNotExist() {
    const createLogEventsTable = `
      CREATE TABLE IF NOT EXISTS log_events (
        event_id UUID,
        deployment_id String,
        log String,
        timestamp DateTime DEFAULT now(),
        level String DEFAULT 'INFO'
      )
      ENGINE = MergeTree()
      ORDER BY (timestamp, deployment_id);
    `;

    const createBuildMetricsTable = `
      CREATE TABLE IF NOT EXISTS build_metrics (
        deployment_id String,
        project_uri String,
        start_time DateTime,
        end_time DateTime,
        duration_seconds UInt32,
        status String,
        error_message String DEFAULT '',
        timestamp DateTime DEFAULT now()
      )
      ENGINE = MergeTree()
      ORDER BY (timestamp, deployment_id);
    `;

    try {
      await this.client.exec({ query: createLogEventsTable });
      await this.client.exec({ query: createBuildMetricsTable });
      logger.info('ClickHouse tables verified');
    } catch (error) {
      throw new BuildError(
        'Failed to create ClickHouse tables',
        ErrorHandler.BUILD_ERROR_CODES.CLICKHOUSE_ERROR,
        { originalError: error.message }
      );
    }
  }

  async insertBuildLog(deploymentId, log, level = 'INFO') {
    if (!this.isConnected) {
      throw new BuildError(
        'ClickHouse client not connected',
        ErrorHandler.BUILD_ERROR_CODES.CLICKHOUSE_ERROR
      );
    }

    try {
      await this.client.insert({
        table: 'log_events',
        values: [{
          event_id: crypto.randomUUID(),
          deployment_id: deploymentId,
          log: log,
          level: level,
          timestamp: new Date()
        }],
        format: 'JSONEachRow'
      });
    } catch (error) {
      logger.error('Failed to insert build log:', error);
      // Don't throw here to prevent build process interruption
    }
  }

  async recordBuildMetrics(deploymentId, projectUri, startTime, endTime, status, errorMessage = '') {
    if (!this.isConnected) {
      throw new BuildError(
        'ClickHouse client not connected',
        ErrorHandler.BUILD_ERROR_CODES.CLICKHOUSE_ERROR
      );
    }

    const durationSeconds = Math.floor((endTime - startTime) / 1000);

    try {
      await this.client.insert({
        table: 'build_metrics',
        values: [{
          deployment_id: deploymentId,
          project_uri: projectUri,
          start_time: startTime,
          end_time: endTime,
          duration_seconds: durationSeconds,
          status: status,
          error_message: errorMessage,
          timestamp: new Date()
        }],
        format: 'JSONEachRow'
      });
    } catch (error) {
      logger.error('Failed to record build metrics:', error);
      // Don't throw here to prevent build process interruption
    }
  }

  async getBuildLogs(deploymentId) {
    try {
      const query = `
        SELECT *
        FROM log_events
        WHERE deployment_id = {deployment_id: String}
        ORDER BY timestamp ASC
      `;

      const result = await this.client.query({
        query,
        query_params: {
          deployment_id: deploymentId
        }
      });

      return await result.json();
    } catch (error) {
      throw new BuildError(
        'Failed to retrieve build logs',
        ErrorHandler.BUILD_ERROR_CODES.CLICKHOUSE_ERROR,
        { originalError: error.message }
      );
    }
  }

  async getBuildMetrics(deploymentId) {
    try {
      const query = `
        SELECT *
        FROM build_metrics
        WHERE deployment_id = {deployment_id: String}
        LIMIT 1
      `;

      const result = await this.client.query({
        query,
        query_params: {
          deployment_id: deploymentId
        }
      });

      return await result.json();
    } catch (error) {
      throw new BuildError(
        'Failed to retrieve build metrics',
        ErrorHandler.BUILD_ERROR_CODES.CLICKHOUSE_ERROR,
        { originalError: error.message }
      );
    }
  }

  async disconnect() {
    try {
      if (this.isConnected) {
        await this.client.close();
        this.isConnected = false;
        logger.info('ClickHouse connection closed');
      }
    } catch (error) {
      logger.error('Error disconnecting from ClickHouse:', error);
    }
  }
}

module.exports = new ClickHouseService();