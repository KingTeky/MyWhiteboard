const fs = require('fs');
const path = require('path');

const DATA_DIR = path.resolve(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'sessions.json');

function clearSessions() {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      console.log('Data directory does not exist; nothing to clear.');
      return;
    }

    if (fs.existsSync(DATA_FILE)) {
      // Try to remove file first
      try {
        fs.unlinkSync(DATA_FILE);
        console.log(`Removed ${DATA_FILE}`);
        return;
      } catch (e) {
        console.warn(`Failed to delete ${DATA_FILE} (will try to overwrite):`, e.message || e);
      }
    }

    // As a fallback, write an empty object to the file
    try {
      fs.writeFileSync(DATA_FILE, JSON.stringify({}, null, 2), 'utf8');
      console.log(`Wrote empty sessions object to ${DATA_FILE}`);
    } catch (e) {
      console.error(`Failed to write empty ${DATA_FILE}:`, e.message || e);
      process.exitCode = 2;
    }
  } catch (err) {
    console.error('Error while clearing sessions:', err.message || err);
    process.exitCode = 1;
  }
}

clearSessions();
