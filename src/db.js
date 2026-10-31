import mongoose from 'mongoose';
import { config } from './config.js';
import { Profile } from './models/Profile.js';
import { Project } from './models/Project.js';

mongoose.set('strictQuery', true);

let connecting;
/** Connects once and reuses the connection (also safe for serverless hosts). */
export function connect() {
  if (mongoose.connection.readyState === 1) return Promise.resolve(mongoose);
  connecting ??= mongoose
    .connect(config.mongoUri, { serverSelectionTimeoutMS: 8000 })
    .then(async (m) => {
      await seedFirstRun();
      return m;
    })
    .catch((err) => {
      connecting = undefined; // try again on the next request
      throw err;
    });
  return connecting;
}

export async function disconnect() {
  connecting = undefined;
  await mongoose.disconnect();
}

// First run only: fill the site with sample content. Edit it from the admin.
async function seedFirstRun() {
  const res = await Profile.updateOne(
    { key: 'main' },
    { $setOnInsert: { name: 'Your Name', title: 'Web Developer', email: 'you@example.com' } },
    { upsert: true }
  );
  if (!res.upsertedCount) return;
  const day = 24 * 60 * 60 * 1000;
  const samples = [
    ['Recipe Finder', 'Search recipes by ingredient and save favourites to a list.', ['React', 'API'], 15],
    ['Task Board API', 'A REST API for boards, lists and cards, with token login.', ['Node.js', 'Express'], 11],
    ['Weather Now', 'A tiny forecast app that shows the next 24 hours for any city.', ['API', 'JavaScript'], 4],
    ['Storefront Redesign', 'A faster, mobile-first rebuild of a small shop website with a simple checkout flow.', ['HTML', 'CSS', 'JavaScript'], 0],
  ];
  await Project.insertMany(
    samples.map(([title, description, tags, daysAgo]) => ({ title, description, tags, createdAt: new Date(Date.now() - daysAgo * day) }))
  );
}
