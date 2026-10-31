import mongoose from 'mongoose';

// One document only (key = "main"): the owner of the portfolio.
const schema = new mongoose.Schema(
  {
    key: { type: String, default: 'main', unique: true },
    name: { type: String, default: '' },
    title: { type: String, default: '' },
    bio: { type: String, default: '' },
    email: { type: String, default: '' },
    github: { type: String, default: '' },
    linkedin: { type: String, default: '' },
    photo: { type: String, default: '' }, // name of a document in the images collection
  },
  { timestamps: true }
);

export const Profile = mongoose.model('Profile', schema);
