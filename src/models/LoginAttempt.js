import mongoose from 'mongoose';

const schema = new mongoose.Schema({
  ip: { type: String, required: true, unique: true },
  count: { type: Number, default: 0 },
  lockedUntil: { type: Number, default: 0 },
  // Old records clean themselves up after a day.
  updatedAt: { type: Date, default: Date.now, expires: 24 * 60 * 60 },
});

export const LoginAttempt = mongoose.model('LoginAttempt', schema);
