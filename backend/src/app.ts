import express from 'express';
import cors from 'cors';
import branchRoutes from './routes/branch.routes';
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
app.use('/api/branches', branchRoutes);

export default app;