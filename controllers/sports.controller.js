import sportsRepository from '../repositories/sports.repository.js';
import sportsApiService from '../services/sports/sports-api.service.js';
import quantService from '../services/sports/quant.service.js';

export class SportsController {
  /**
   * GET /api/sports/bankroll
   * Retrieve current bankroll settings and tilt telemetry for logged-in user.
   */
  async getBankroll(req, res, next) {
    try {
      const userId = req.user.id;
      const bankroll = await sportsRepository.getBankrollSettings(userId);
      const telemetry = await sportsRepository.getStreakTelemetry(userId);

      return res.status(200).json({
        success: true,
        data: {
          bankroll,
          telemetry,
        },
      });
    } catch (err) {
      return next(err);
    }
  }

  /**
   * PUT /api/sports/bankroll
   * Update bankroll settings (total bankroll, currency, staking model, etc.).
   */
  async updateBankroll(req, res, next) {
    try {
      const userId = req.user.id;
      const {
        totalBankroll,
        currency,
        stakingModel,
        maxUnitLimitPercent,
        dailyStopLossPercent,
      } = req.body;

      const updated = await sportsRepository.updateBankrollSettings(userId, {
        totalBankroll: totalBankroll !== undefined ? Number(totalBankroll) : undefined,
        currency,
        stakingModel,
        maxUnitLimitPercent: maxUnitLimitPercent !== undefined ? Number(maxUnitLimitPercent) : undefined,
        dailyStopLossPercent: dailyStopLossPercent !== undefined ? Number(dailyStopLossPercent) : undefined,
      });

      return res.status(200).json({
        success: true,
        message: 'Bankroll settings updated successfully.',
        data: updated,
      });
    } catch (err) {
      return next(err);
    }
  }

  /**
   * POST /api/sports/reset-tilt
   * Reset tilt lockout and loss streak.
   */
  async resetTilt(req, res, next) {
    try {
      const userId = req.user.id;
      const telemetry = await sportsRepository.resetStreakTelemetry(userId);
      return res.status(200).json({
        success: true,
        message: 'Circuit breaker reset. Tilt shield cleared.',
        data: telemetry,
      });
    } catch (err) {
      return next(err);
    }
  }

  /**
   * POST /api/sports/simulate-tilt
   * Testing helper: simulate 3 consecutive losses to trigger circuit breaker.
   */
  async simulateTilt(req, res, next) {
    try {
      const userId = req.user.id;
      const { losses = 3 } = req.body;
      const telemetry = await sportsRepository.updateStreakTelemetry(userId, {
        consecutiveLosses: Number(losses),
        circuitBreakerActive: true,
        lockoutUntil: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24h lockout
      });

      return res.status(200).json({
        success: true,
        message: `Simulated ${losses} consecutive losses. Circuit breaker active.`,
        data: telemetry,
      });
    } catch (err) {
      return next(err);
    }
  }

  /**
   * GET /api/sports/ledger
   * Retrieve historical bet recommendations and performance.
   */
  async getLedger(req, res, next) {
    try {
      const userId = req.user.id;
      const limit = parseInt(req.query.limit, 10) || 20;
      const ledger = await sportsRepository.getLedger(userId, limit);
      return res.status(200).json({
        success: true,
        data: ledger,
      });
    } catch (err) {
      return next(err);
    }
  }

  /**
   * POST /api/sports/preview-fixture
   * Direct quantitative calculation preview for any team pairing.
   */
  async previewFixture(req, res, next) {
    try {
      const userId = req.user.id;
      const { homeTeam, awayTeam, isLookahead } = req.body;

      if (!homeTeam || !awayTeam) {
        return res.status(400).json({
          success: false,
          error: { code: 'INVALID_INPUT', message: 'homeTeam and awayTeam are required.' },
        });
      }

      const bankroll = await sportsRepository.getBankrollSettings(userId);
      const intel = await sportsApiService.getFixtureIntel({ homeTeam, awayTeam, isLookahead });
      const quant = quantService.analyzeMatch({
        homeTeam,
        awayTeam,
        matchIntel: intel,
        bankrollSettings: bankroll,
      });

      return res.status(200).json({
        success: true,
        data: {
          intel,
          quant,
        },
      });
    } catch (err) {
      return next(err);
    }
  }

  /**
   * GET /api/sports/upcoming-matches?league=Premier%20League
   * Retrieve live upcoming fixtures and real-time bookmaker odds for the Match Forecaster Drawer.
   */
  async getUpcomingMatches(req, res, next) {
    try {
      const league = req.query.league || 'Premier League';
      const matches = await sportsApiService.getUpcomingLeagueFixtures(league);
      return res.status(200).json({
        success: true,
        data: matches,
      });
    } catch (err) {
      return next(err);
    }
  }
}

export const sportsController = new SportsController();
export default sportsController;
