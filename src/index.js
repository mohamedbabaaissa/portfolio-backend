import { createApp } from './app.js';
import { config, configProblem } from './config.js';
import { connect } from './db.js';

const problem = configProblem();
if (problem) {
  console.error(`${problem}\nCopy .env.example to .env and fill it in.`);
  process.exit(1);
}

try {
  await connect();
  console.log('MongoDB connected.');
} catch (err) {
  console.error(`Could not connect to MongoDB: ${err.message}`);
  process.exit(1);
}

createApp().listen(config.port, () => console.log(`API running at http://localhost:${config.port}`));
