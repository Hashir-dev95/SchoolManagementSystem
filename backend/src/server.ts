import 'dotenv/config';

import app from './app';
import connectDatabase from './config/database';

const PORT = process.env.PORT || 5000;

const startServer = async (): Promise<void> => {
  await connectDatabase();

  const PORT_NUM = typeof PORT === 'string' ? parseInt(PORT, 10) : PORT;

  if (isNaN(PORT_NUM)) {
    throw new Error('Invalid PORT');
  }

  app.listen(PORT_NUM, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
  });
};

startServer();