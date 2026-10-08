import healthService from '../services/health.service.js';

/**
 * HealthController
 * Handles requests to inspect system and database health.
 */
export class HealthController {
  /**
   * GET /api/health
   * Verifies database connectivity and returns server diagnostics.
   */
  async getHealth(req, res, next) {
    try {
      const healthData = await healthService.checkHealth();
      const statusCode = healthData.database.status === 'connected' ? 200 : 503;
      return res.status(statusCode).json(healthData);
    } catch (error) {
      return next(error);
    }
  }
}

export const healthController = new HealthController();
export default healthController;
