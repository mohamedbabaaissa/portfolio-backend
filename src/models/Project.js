import mongoose from 'mongoose';

const schema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    description: { type: String, default: '' },
    link: { type: String, default: '' },
    tags: { type: [String], default: [] },
    image: { type: String, default: '' }, // name of a document in the images collection
  },
  { timestamps: true }
);
schema.index({ createdAt: -1 });

export const Project = mongoose.model('Project', schema);
