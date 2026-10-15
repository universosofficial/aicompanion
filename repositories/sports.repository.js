import baseRepository from './base.repository.js';

/**
 * SportsRepository
 * Database access layer for user bankroll settings, market caching,
 * bet recommendation tracking, and behavioral tilt telemetry.
 */
export class SportsRepository {
  /**
   * Fetch or initialize bankroll settings for a user.
   */
  async getBankrollSettings(userId) {
    const sql = `SELECT * FROM user_bankroll_settings WHERE user_id = ? LIMIT 1`;
    const row = await baseRepository.queryOne(sql, [userId]);
    if (row) {
      return {
        ...row,
        total_bankroll: Number(row.total_bankroll),
        max_unit_limit_percent: Number(row.max_unit_limit_percent),
        daily_stop_loss_percent: Number(row.daily_stop_loss_percent),
      };
    }

    // Initialize defaults: $1,000 bankroll, USD, quarter_kelly, 2.5% max unit, 5% stop loss
    const insertSql = `
      INSERT INTO user_bankroll_settings (
        user_id, total_bankroll, currency, staking_model, max_unit_limit_percent, daily_stop_loss_percent
      ) VALUES (?, 1000.00, 'USD', 'quarter_kelly', 2.50, 5.00)
    `;
    await baseRepository.execute(insertSql, [userId]);
    return await this.getBankrollSettings(userId);
  }

  /**
   * Update user bankroll settings.
   */
  async updateBankrollSettings(userId, {
    totalBankroll,
    currency,
    stakingModel,
    maxUnitLimitPercent,
    dailyStopLossPercent,
  }) {
    const existing = await this.getBankrollSettings(userId);
    const sql = `
      UPDATE user_bankroll_settings
      SET
        total_bankroll = ?,
        currency = ?,
        staking_model = ?,
        max_unit_limit_percent = ?,
        daily_stop_loss_percent = ?
      WHERE user_id = ?
    `;

    await baseRepository.execute(sql, [
      totalBankroll !== undefined ? totalBankroll : (existing?.total_bankroll ?? 1000.00),
      currency || existing?.currency || 'USD',
      stakingModel || existing?.staking_model || 'quarter_kelly',
      maxUnitLimitPercent !== undefined ? maxUnitLimitPercent : (existing?.max_unit_limit_percent ?? 2.50),
      dailyStopLossPercent !== undefined ? dailyStopLossPercent : (existing?.daily_stop_loss_percent ?? 5.00),
      userId,
    ]);

    return await this.getBankrollSettings(userId);
  }

  /**
   * Fetch or initialize streak & tilt telemetry for a user.
   */
  async getStreakTelemetry(userId) {
    const sql = `SELECT * FROM user_streak_telemetry WHERE user_id = ? LIMIT 1`;
    const row = await baseRepository.queryOne(sql, [userId]);
    if (row) {
      const isLocked = row.lockout_until && new Date(row.lockout_until) > new Date();
      return {
        ...row,
        consecutive_losses: Number(row.consecutive_losses),
        daily_pnl: Number(row.daily_pnl),
        circuit_breaker_active: Boolean(row.circuit_breaker_active || isLocked),
      };
    }

    const insertSql = `
      INSERT INTO user_streak_telemetry (user_id, consecutive_losses, daily_pnl, circuit_breaker_active)
      VALUES (?, 0, 0.00, FALSE)
    `;
    await baseRepository.execute(insertSql, [userId]);
    return await this.getStreakTelemetry(userId);
  }

  /**
   * Update streak telemetry (e.g. increment loss, record PnL, set lockout).
   */
  async updateStreakTelemetry(userId, { consecutiveLosses, dailyPnl, circuitBreakerActive, lockoutUntil }) {
    await this.getStreakTelemetry(userId); // ensure row exists

    const fields = [];
    const values = [];

    if (consecutiveLosses !== undefined) {
      fields.push('consecutive_losses = ?');
      values.push(consecutiveLosses);
    }
    if (dailyPnl !== undefined) {
      fields.push('daily_pnl = ?');
      values.push(dailyPnl);
    }
    if (circuitBreakerActive !== undefined) {
      fields.push('circuit_breaker_active = ?');
      values.push(circuitBreakerActive ? 1 : 0);
    }
    if (lockoutUntil !== undefined) {
      fields.push('lockout_until = ?');
      values.push(lockoutUntil);
    }

    if (fields.length > 0) {
      values.push(userId);
      await baseRepository.execute(
        `UPDATE user_streak_telemetry SET ${fields.join(', ')} WHERE user_id = ?`,
        values
      );
    }

    return await this.getStreakTelemetry(userId);
  }

  /**
   * Reset tilt circuit breaker and loss streak for a user.
   */
  async resetStreakTelemetry(userId) {
    const sql = `
      UPDATE user_streak_telemetry
      SET consecutive_losses = 0, circuit_breaker_active = FALSE, lockout_until = NULL
      WHERE user_id = ?
    `;
    await baseRepository.execute(sql, [userId]);
    return await this.getStreakTelemetry(userId);
  }

  /**
   * Get cached sports data by key if not expired.
   */
  async getCachedMarket(cacheKey) {
    const sql = `
      SELECT payload FROM sports_market_cache
      WHERE cache_key = ? AND expires_at > NOW()
      LIMIT 1
    `;
    const row = await baseRepository.queryOne(sql, [cacheKey]);
    if (!row) return null;
    try {
      return typeof row.payload === 'string'
        ? JSON.parse(row.payload)
        : row.payload;
    } catch {
      return null;
    }
  }

  /**
   * Cache market payload with given TTL seconds.
   */
  async setCachedMarket(cacheKey, fixtureName, payload, ttlSeconds) {
    const serialized = JSON.stringify(payload);
    const sql = `
      INSERT INTO sports_market_cache (cache_key, fixture_name, payload, expires_at)
      VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL ? SECOND))
      ON DUPLICATE KEY UPDATE
        fixture_name = VALUES(fixture_name),
        payload = VALUES(payload),
        expires_at = VALUES(expires_at)
    `;
    await baseRepository.execute(sql, [cacheKey, fixtureName, serialized, ttlSeconds]);
  }

  /**
   * Record bet recommendation in ledger.
   */
  async recordBetRecommendation({
    userId,
    characterId,
    fixtureName,
    marketType,
    recommendedSelection,
    modelWinProb,
    entryOdds,
    recommendedStakeUnits,
    recommendedStakeAmount,
  }) {
    const sql = `
      INSERT INTO bet_recommendation_ledger (
        user_id, character_id, fixture_name, market_type, recommended_selection,
        model_win_prob, entry_odds, recommended_stake_units, recommended_stake_amount
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    const result = await baseRepository.execute(sql, [
      userId,
      characterId,
      fixtureName,
      marketType,
      recommendedSelection,
      modelWinProb,
      entryOdds,
      recommendedStakeUnits,
      recommendedStakeAmount,
    ]);
    return result.insertId;
  }

  /**
   * Get recommendation ledger history for a user.
   */
  async getLedger(userId, limit = 20) {
    const sql = `
      SELECT * FROM bet_recommendation_ledger
      WHERE user_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `;
    const [rows] = await baseRepository.query(sql, [userId, limit]);
    return rows || [];
  }
}

export const sportsRepository = new SportsRepository();
export default sportsRepository;
