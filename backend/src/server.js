const path = require('node:path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const express = require('express');
const cors = require('cors');
const apiRoutes = require('./routes');
const { attachChatRealtime } = require('./chatRealtime');
const { startParentPaymentReconciler } = require('./parentPaymentReconciler');
const { connectDatabase, closeDatabase, getDatabase } = require('./database');

const app = express();
app.use(cors());
app.use(express.json());

app.get('/health', async (_req, res) => {
  try {
    await getDatabase().command({ ping: 1 });
    return res.status(200).json({
      success: true,
      status: 'ok',
      database: 'connected',
    });
  } catch (error) {
    console.error(`Health check failed (${error.name}): ${error.message}`);
    return res.status(503).json({
      success: false,
      status: 'unavailable',
      database: 'disconnected',
    });
  }
});

app.get('/', (_req, res) =>
  res.json({
    success: true,
    message: 'School Management System API is running',
  }),
);
app.use('/api', apiRoutes);
app.use((error, _req, res, _next) => {
  console.error(`Request failed (${error.name}): ${error.message}`);
  const reportableIntegrationError =
    typeof error.code === 'string' &&
    (error.code.startsWith('INTEGRATION_REFERENCE_') ||
      error.code === 'ROLE_ACCESS_DENIED' ||
      error.code === 'BRANCH_ACCESS_DENIED');
  res.status(reportableIntegrationError ? error.statusCode || 503 : 500).json({
    success: false,
    error: reportableIntegrationError ? error.message : 'Unexpected server error',
    ...(reportableIntegrationError ? { code: error.code } : {}),
  });
});

async function startServer() {
  const port = Number(process.env.PORT) || 5000;
  await connectDatabase();
  await apiRoutes.initializeFinanceIndexes();
  await apiRoutes.initializeChatIndexes();
  const parentPaymentReconciler = startParentPaymentReconciler();
  const server = app.listen(port, () =>
    console.log(
      `JavaScript API server listening on port ${port}; MongoDB connected`,
    ),
  );
  const chatRealtime = attachChatRealtime(server);
  apiRoutes.setChatRealtimePublisher(chatRealtime.publish);

  const shutdown = signal => {
    console.log(`${signal} received; shutting down`);
    parentPaymentReconciler.stop();
    server.close(async error => {
      try {
        await closeDatabase();
      } finally {
        process.exit(error ? 1 : 0);
      }
    });
  };
  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));
  return server;
}

if (require.main === module) {
  startServer().catch(error => {
    console.error(`API startup failed (${error.name}): ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { app, startServer };
