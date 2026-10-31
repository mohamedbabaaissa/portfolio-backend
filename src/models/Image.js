import mongoose from 'mongoose';

// Uploaded photos live in MongoDB (max 4 MB each, well under the 16 MB document limit),
// so the backend needs no permanent disk and works on any host.
const schema = new mongoose.Schema({
  name: { type: String, required: true, unique: true },
  mime: { type: String, required: true },
  data: { type: Buffer, required: true },
});

export const Image = mongoose.model('Image', schema);
