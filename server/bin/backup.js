#!/usr/bin/env node
import { Store } from '../src/store.js';
import { loadConfig } from '../src/config.js';
const cfg = loadConfig();
const s = new Store(cfg.server.dataDir, cfg.persistence);
console.log('backup written to', s.backup());
