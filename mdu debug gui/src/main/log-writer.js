'use strict';

const fs = require('fs');
const path = require('path');

class LogWriter {
  constructor(onStatusChange = () => {}) {
    this.onStatusChange = onStatusChange;
    this.stream = null;
    this.filePath = null;
    this.linesWritten = 0;
    this.bytesWritten = 0;
    this.lastError = null;
  }

  getStatus() {
    return {
      active: Boolean(this.stream),
      filePath: this.filePath,
      linesWritten: this.linesWritten,
      bytesWritten: this.bytesWritten,
      lastError: this.lastError,
    };
  }

  async start(filePath) {
    if (!filePath) {
      throw new Error('A log file path is required.');
    }

    if (this.stream) {
      this.stop();
    }

    await fs.promises.mkdir(path.dirname(filePath), { recursive: true });

    this.filePath = filePath;
    this.linesWritten = 0;
    this.bytesWritten = 0;
    this.lastError = null;
    this.stream = fs.createWriteStream(filePath, { flags: 'a' });
    this.stream.on('error', (error) => {
      this.lastError = error.message;
      this.onStatusChange(this.getStatus());
    });

    this.write({
      type: 'session_start',
      timestamp: new Date().toISOString(),
    });

    this.onStatusChange(this.getStatus());
    return this.getStatus();
  }

  stop() {
    if (!this.stream) {
      return this.getStatus();
    }

    this.write({
      type: 'session_end',
      timestamp: new Date().toISOString(),
    });

    const stream = this.stream;
    this.stream = null;
    stream.end();
    this.onStatusChange(this.getStatus());
    return this.getStatus();
  }

  write(entry) {
    if (!this.stream) {
      return false;
    }

    const line = `${JSON.stringify(entry)}\n`;
    this.stream.write(line);
    this.linesWritten += 1;
    this.bytesWritten += Buffer.byteLength(line);
    return true;
  }
}

module.exports = {
  LogWriter,
};
