import express from 'express';
import cors from 'cors';
import compression from 'compression';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import env from './config/env.js';
import { testConnection, closePool } from './config/database.js';
import healthRoutes from './routes/health.routes.js';
import authRoutes from './routes/auth.routes.js';
import characterRoutes from './routes/character.routes.js';
import chatRoutes from './routes/chat.routes.js';
import memoryRoutes from './routes/memory.routes.js';
import mindRoutes from './routes/mind.routes.js';
import myMindRoutes from './routes/my-mind.routes.js';
import uploadRoutes from './routes/upload.routes.js';
import voiceRoutes from './routes/voice.routes.js';
import path from 'path';
import { fileURLToPath } from 'url';
import errorHandler from './middleware/errorHandler.middleware.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

app.set('trust proxy', 1);

// Security Headers (configured to allow Cloudinary CDN assets)
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));

// HTTP Payload Compression (skips SSE streams to ensure instant token delivery)
app.use(
  compression({
    filter: (req, res) => {
      if (req.headers.accept === 'text/event-stream' || req.headers['content-type'] === 'text/event-stream') {
        return false;
      }
      return compression.filter(req, res);
    },
    threshold: 1024,
  })
);

// Global Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Rate Limiters for High Concurrency Protection
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 600,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: {
      code: 'TOO_MANY_REQUESTS',
      message: 'Too many requests from this IP, please try again shortly.',
    },
  },
});

const aiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: {
      code: 'AI_RATE_LIMIT',
      message: 'AI conversation rate limit reached. Please wait a moment before sending more messages.',
    },
  },
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: {
      code: 'AUTH_RATE_LIMIT',
      message: 'Too many authentication attempts. Please try again later.',
    },
  },
});

app.use(globalLimiter);

// Request logger for development
if (env.NODE_ENV === 'development') {
  app.use((req, res, next) => {
    console.log(`[HTTP] ${req.method} ${req.url}`);
    next();
  });
}

// API Routes with Calibrated Rate Limiters
app.use('/api/health', healthRoutes);
app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/characters', characterRoutes);
app.use('/api/chat', aiLimiter, chatRoutes);
app.use('/api/memories', memoryRoutes);
app.use('/api/minds', aiLimiter, mindRoutes);
app.use('/api/my-mind', myMindRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/voice', aiLimiter, voiceRoutes);

// Undefined Route Fallback (404)
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: {
      code: 'NOT_FOUND',
      message: `Route ${req.method} ${req.originalUrl} not found`,
    },
  });
});

// Centralized Error Handling Middleware (must be registered last)
app.use(errorHandler);

// Start Server
const server = app.listen(env.PORT, async () => {
  console.log('====================================================');
  console.log(` AI COMPANION BACKEND running on port ${env.PORT}`);
  console.log(` Mode: ${env.NODE_ENV}`);
  console.log(` Health Endpoint:     http://localhost:${env.PORT}/api/health`);
  console.log(` Auth Endpoint:       http://localhost:${env.PORT}/api/auth`);
  console.log(` Characters Endpoint: http://localhost:${env.PORT}/api/characters`);
  console.log(` Chat Endpoint:       http://localhost:${env.PORT}/api/chat`);
  console.log(` Memory Endpoint:     http://localhost:${env.PORT}/api/memories`);
  console.log('====================================================');

  // Verify database connection on startup
  const isDbConnected = await testConnection(3, 2000);
  if (!isDbConnected) {
    console.warn(
      '[STARTUP WARNING] Database is currently unreachable. ' +
      'Health check endpoint will report degraded status until MySQL is accessible.'
    );
  }

  // High concurrency reverse proxy keep-alive timeouts (Cloudflare, Nginx, ALB)
  server.keepAliveTimeout = 65000;
  server.headersTimeout = 66000;
});

// Graceful Shutdown Handling
const shutdown = async (signal) => {
  console.log(`\n[SHUTDOWN] Received ${signal}. Gracefully closing server and database pool...`);
  server.close(async () => {
    await closePool();
    console.log('[SHUTDOWN] Server exited cleanly.');
    process.exit(0);
  });
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

export default app;
