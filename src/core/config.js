const fs = require('fs');
const path = require('path');

class Config {
  constructor(dir) {
    this.file = path.join(dir, 'config.json');
    this.data = { proxyUrl: null, targetPath: null, rememberTarget: true, lastProbe: null };
    this.load();
  }

  load() {
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      this.data = { ...this.data, ...raw };
    } catch {
      /* first run */
    }
    return this;
  }

  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2));
  }

  set(patch) {
    this.data = { ...this.data, ...patch };
    this.save();
    return this.data;
  }
}

module.exports = Config;
