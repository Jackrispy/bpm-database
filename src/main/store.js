// Tiny JSON-file stores in userData: the stats cache and app settings.
const fs = require('fs');
const path = require('path');

class JsonStore {
  constructor(file, defaults = {}) {
    this.file = file;
    this.data = defaults;
    try {
      this.data = { ...defaults, ...JSON.parse(fs.readFileSync(file, 'utf8')) };
    } catch {
      // Missing or corrupt file: start fresh.
    }
    this.timer = null;
  }
  get(key) {
    return this.data[key];
  }
  set(key, value) {
    this.data[key] = value;
    this.scheduleSave();
  }
  delete(key) {
    delete this.data[key];
    this.scheduleSave();
  }
  scheduleSave() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 500);
  }
  flush() {
    clearTimeout(this.timer);
    this.timer = null;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.data));
    fs.renameSync(tmp, this.file);
  }
}

module.exports = { JsonStore };
