const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const config = require('./config/config');
const s3Service = require('./services/s3Service');
const kafkaService = require('./services/kafkaService');
const clickhouseService = require('./services/clickhouseService');
const { ErrorHandler, BuildError } = require('./utils/errorHandler');
const logger = require('./utils/logger');

class BuildServer {
  constructor() {
    this.outputDir = path.join(__dirname, '../output');
    this.isExiting = false;
    this.buildStartTime = null;
    this.buildProcess = null;
  }

  async initialize() {
    try {
      // Validate environment variables
      ErrorHandler.validateEnvironment([
        'PROJECT_URI',
        'DEPLOYMENT_ID',
        'PROJECT_INSTALL_COMMAND',
        'PROJECT_BUILD_COMMAND',
        'PROJECT_ROOT_DIR'
      ]);

      // Initialize services
      logger.info('Initializing services...');
      await clickhouseService.initialize();
      await kafkaService.connect();
      
      this.buildStartTime = new Date();
      await this.setupCleanup();
      await this.runBuild();
    } catch (error) {
      ErrorHandler.handleError(error, logger, kafkaService);
      await this.cleanup(error);
      process.exit(1);
    }
  }

  async runBuild() {
    try {
      // Prepare output directory
      await this.prepareOutputDirectory();

      // Start build process
      await kafkaService.publishLog('Starting build process...');
      await clickhouseService.insertBuildLog(
        config.project.deploymentId,
        'Build process started'
      );

      // Execute build
      await this.executeBuildProcess();

      // Upload artifacts
      await this.uploadArtifacts();

      // Record successful completion
      await kafkaService.publishLog('Build completed successfully');
      await clickhouseService.insertBuildLog(
        config.project.deploymentId,
        'Build completed successfully',
        'INFO'
      );

      await this.cleanup();
      process.exit(0);

    } catch (error) {
      const errorMessage = `Build failed: ${error.message}`;
      await kafkaService.publishLog(errorMessage);
      await clickhouseService.insertBuildLog(
        config.project.deploymentId,
        errorMessage,
        'ERROR'
      );
      
      await this.cleanup(error);
      process.exit(1);
    }
  }

  async prepareOutputDirectory() {
    try {
      if (fs.existsSync(this.outputDir)) {
        fs.rmSync(this.outputDir, { recursive: true, force: true });
      }
      fs.mkdirSync(this.outputDir, { recursive: true });
      logger.info('Output directory prepared');
    } catch (error) {
      throw new BuildError(
        'Failed to prepare output directory',
        ErrorHandler.BUILD_ERROR_CODES.INITIALIZATION_FAILED,
        { originalError: error.message }
      );
    }
  }

  async executeBuildProcess() {
    return new Promise((resolve, reject) => {
      let buildOutput = '';
      let buildErrors = '';

      this.buildProcess = exec(
        `cd ${this.outputDir} && ${config.project.installCommand} && ${config.project.buildCommand}`,
        {
          cwd: config.project.rootDir,
          env: {
            ...process.env,
            ...this.getProjectEnvironmentVariables()
          },
          maxBuffer: 10 * 1024 * 1024 // 10MB buffer
        }
      );

      this.buildProcess.stdout.on('data', async (data) => {
        const output = data.toString();
        buildOutput += output;
        logger.info(output.trim());
        await Promise.all([
          kafkaService.publishLog(output),
          clickhouseService.insertBuildLog(config.project.deploymentId, output)
        ]);
      });

      this.buildProcess.stderr.on('data', async (data) => {
        const error = data.toString();
        buildErrors += error;
        logger.error(error.trim());
        await Promise.all([
          kafkaService.publishLog(`Error: ${error}`),
          clickhouseService.insertBuildLog(
            config.project.deploymentId,
            error,
            'ERROR'
          )
        ]);
      });

      this.buildProcess.on('close', async (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new BuildError(
            `Build process exited with code ${code}\n${buildErrors}`,
            ErrorHandler.BUILD_ERROR_CODES.BUILD_FAILED,
            { exitCode: code, buildErrors }
          ));
        }
      });

      this.buildProcess.on('error', (error) => {
        reject(new BuildError(
          `Failed to start build process: ${error.message}`,
          ErrorHandler.BUILD_ERROR_CODES.BUILD_FAILED,
          { originalError: error }
        ));
      });

      // Set a timeout for the build process
      const buildTimeout = setTimeout(() => {
        this.buildProcess.kill();
        reject(new BuildError(
          'Build process timed out',
          ErrorHandler.BUILD_ERROR_CODES.BUILD_FAILED,
          { timeout: true }
        ));
      }, 30 * 60 * 1000); // 30 minutes timeout

      this.buildProcess.on('close', () => clearTimeout(buildTimeout));
    });
  }

  async uploadArtifacts() {
    const distDir = path.join(this.outputDir, 'dist');
    if (!fs.existsSync(distDir)) {
      throw new BuildError(
        'Build directory not found',
        ErrorHandler.BUILD_ERROR_CODES.BUILD_FAILED
      );
    }

    const files = fs.readdirSync(distDir, { recursive: true });
    const uploadPromises = [];
    let uploadedCount = 0;
    const totalFiles = files.filter(file => 
      !fs.lstatSync(path.join(distDir, file)).isDirectory()
    ).length;

    for (const file of files) {
      const filePath = path.join(distDir, file);
      if (fs.lstatSync(filePath).isDirectory()) continue;

      const uploadPromise = (async () => {
        try {
          await s3Service.uploadFile(filePath, config.project.uri);
          uploadedCount++;
          await kafkaService.publishLog(
            `Upload progress: ${uploadedCount}/${totalFiles} files`
          );
        } catch (error) {
          throw new BuildError(
            `Failed to upload ${file}`,
            ErrorHandler.BUILD_ERROR_CODES.UPLOAD_FAILED,
            { originalError: error.message }
          );
        }
      })();

      uploadPromises.push(uploadPromise);
    }

    await Promise.all(uploadPromises);
  }

  getProjectEnvironmentVariables() {
    return Object.keys(process.env)
      .filter(key => key.startsWith('PROJECT_ENVIRONMENT_'))
      .reduce((envVars, key) => {
        envVars[key] = process.env[key];
        return envVars;
      }, {});
  }

  async setupCleanup() {
    process.on('SIGTERM', async () => {
      logger.info('Received SIGTERM');
      await this.cleanup();
      process.exit(0);
    });

    process.on('SIGINT', async () => {
      logger.info('Received SIGINT');
      await this.cleanup();
      process.exit(0);
    });

    // Handle uncaught exceptions
    process.on('uncaughtException', async (error) => {
      logger.error('Uncaught exception:', error);
      await this.cleanup(error);
      process.exit(1);
    });

    // Handle unhandled promise rejections
    process.on('unhandledRejection', async (error) => {
      logger.error('Unhandled rejection:', error);
      await this.cleanup(error);
      process.exit(1);
    });
  }

  async cleanup(error = null) {
    if (this.isExiting) return;
    this.isExiting = true;

    const buildEndTime = new Date();
    const status = error ? 'FAILED' : 'SUCCESS';
    const errorMessage = error ? error.message : '';

    try {
      // Kill build process if it's still running
      if (this.buildProcess && !this.buildProcess.killed) {
        this.buildProcess.kill();
      }

      // Record build metrics
      await clickhouseService.recordBuildMetrics(
        config.project.deploymentId,
        config.project.uri,
        this.buildStartTime,
        buildEndTime,
        status,
        errorMessage
      );

      // Graceful shutdown
      await ErrorHandler.gracefulShutdown(
        {
          kafka: kafkaService,
          clickhouse: clickhouseService,
          cleanup: async () => {
            if (fs.existsSync(this.outputDir)) {
              fs.rmSync(this.outputDir, { recursive: true, force: true });
            }
          }
        },
        logger
      );
    } catch (cleanupError) {
      logger.error('Cleanup failed:', cleanupError);
    }
  }
}

// Start the build server
const buildServer = new BuildServer();
buildServer.initialize().catch(error => {
  logger.error('Fatal error:', error);
  process.exit(1);
});