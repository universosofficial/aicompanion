import baseRepository from '../repositories/base.repository.js';
import env from '../config/env.js';

export class HealthService {
  /**
   * Performs database connectivity check and system telemetry diagnostics.
   * @returns {Promise<Object>} Health diagnostic payload
   */
  async checkHealth() {
    const startTime = Date.now();
    let dbStatus = 'disconnected';
    let dbLatencyMs = null;
    let dbError = null;

    try {
      const [rows] = await baseRepository.query('SELECT 1 AS status');
      if (rows && rows.length > 0) {
        dbStatus = 'connected';
        dbLatencyMs = Date.now() - startTime;
      }
    } catch (err) {
      dbStatus = 'error';
      dbError = err.message;
    }

    const uptimeSeconds = Math.floor(process.uptime());
    const memory = process.memoryUsage();

    return {
      status: dbStatus === 'connected' ? 'healthy' : 'degraded',
      timestamp: new Date().toISOString(),
      uptime: {
        seconds: uptimeSeconds,
        formatted: `${Math.floor(uptimeSeconds / 3600)}h ${Math.floor((uptimeSeconds % 3600) / 60)}m ${uptimeSeconds % 60}s`,
      },
      environment: env.NODE_ENV,
      database: {
        status: dbStatus,
        latency_ms: dbLatencyMs,
        host: env.DB_HOST,
        name: env.DB_NAME,
        ...(dbError && { error: dbError }),
      },
      process: {
        pid: process.pid,
        node_version: process.version,
        memory_mb: {
          rss: +(memory.rss / (1024 * 1024)).toFixed(2),
          heap_used: +(memory.heapUsed / (1024 * 1024)).toFixed(2),
          heap_total: +(memory.heapTotal / (1024 * 1024)).toFixed(2),
        },
      },
    };
  }
}

export const healthService = new HealthService();
export default healthService;
