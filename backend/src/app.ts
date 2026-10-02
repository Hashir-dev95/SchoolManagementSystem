import express from 'express';
import cors from 'cors';

import authRoutes from './routes/auth.routes';

const app = express();

app.use(cors());
app.use(express.json());

app.get('/', (_req, res) => {
  res.json({
    success: true,
    message: 'School Management System API is running',
  });
});

app.use('/api/auth', authRoutes);

export default app;