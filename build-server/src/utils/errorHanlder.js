class BuildError extends Error {
    constructor(message, code, details = {}) {
      super(message);
      this.name = 'BuildError';
      this.code = code;
      this.details = details;
      Error.captureStackTrace(this, BuildError);
    }
  }
  
  class ErrorHandler {
    static BUILD_ERROR_CODES = {
      INITIALIZATION_FAILED: 'INIT_FAILED',
      BUILD_FAILED: 'BUILD_FAILED',
      UPLOAD_FAILED: 'UPLOAD_FAILED',
      KAFKA_ERROR: 'KAFKA_ERROR',
      S3_ERROR: 'S3_ERROR',
      CLICKHOUSE_ERROR: 'CLICKHOUSE_ERROR',
      VALIDATION_ERROR: 'VALIDATION_ERROR',
      UNKNOWN_ERROR: 'UNKNOWN_ERROR'
    };
  
    static handleError(error, logger, kafkaService = null) {
      const errorDetails = {
        timestamp: new Date().toISOString(),
        name: error.name,
        message: error.message,
        code: error.code || ErrorHandler.BUILD_ERROR_CODES.UNKNOWN_ERROR,
        stack: error.stack
      };
  
      // Log the error
      logger.error('Error occurred:', errorDetails);
  
      // Publish to Kafka if service is available
      if (kafkaService) {
        kafkaService.publishLog(`Error: ${error.message}`).catch(err => {
          logger.error('Failed to publish error to Kafka:', err);
        });
      }
  
      return errorDetails;
    }
  
    static async gracefulShutdown(services, logger) {
      logger.info('Starting graceful shutdown...');
  
      const shutdownPromises = [];
  
      // Disconnect Kafka
      if (services.kafka) {
        shutdownPromises.push(
          services.kafka.disconnect().catch(err => 
            logger.error('Error disconnecting Kafka:', err)
          )
        );
      }
  
      // Disconnect ClickHouse
      if (services.clickhouse) {
        shutdownPromises.push(
          services.clickhouse.disconnect().catch(err => 
            logger.error('Error disconnecting ClickHouse:', err)
          )
        );
      }
  
      // Clean up temporary files
      if (services.cleanup) {
        shutdownPromises.push(
          services.cleanup().catch(err => 
            logger.error('Error during cleanup:', err)
          )
        );
      }
  
      try {
        await Promise.allSettled(shutdownPromises);
        logger.info('Graceful shutdown completed');
      } catch (error) {
        logger.error('Error during graceful shutdown:', error);
      }
    }
  
    static validateEnvironment(requiredVars) {
      const missingVars = requiredVars.filter(varName => !process.env[varName]);
      
      if (missingVars.length > 0) {
        throw new BuildError(
          `Missing required environment variables: ${missingVars.join(', ')}`,
          ErrorHandler.BUILD_ERROR_CODES.VALIDATION_ERROR,
          { missingVars }
        );
      }
    }
  }
  
  module.exports = {
    BuildError,
    ErrorHandler
  };