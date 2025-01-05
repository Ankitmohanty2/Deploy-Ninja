class Logger {
    info(message) {
      console.log(`[INFO] ${message}`);
    }
  
    error(message, error) {
      console.error(`[ERROR] ${message}`, error || '');
    }
  
    warn(message) {
      console.warn(`[WARN] ${message}`);
    }
  }
  
  module.exports = new Logger();