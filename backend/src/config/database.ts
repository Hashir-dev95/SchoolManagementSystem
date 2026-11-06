import mongoose from 'mongoose';

const connectDatabase = async (): Promise<void> => {
  const mongoUri = process.env.MONGODB_URI;

  if (!mongoUri) {
    throw new Error('MONGODB_URI is not defined');
  }

  await mongoose.connect(mongoUri, {
    dbName: process.env.MONGODB_DB || 'school_management',
  });
  console.log('MongoDB connected successfully');
};

export default connectDatabase;
