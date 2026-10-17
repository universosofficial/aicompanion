/**
 * Univasos Native Token Configuration
 * Defines the native token economy parameters for Univasos.
 */
export const TOKEN_CONFIG = {
  name: 'Vasos',
  singular: 'Vaso',
  code: 'VASO',
  symbol: '◈',
  displayFormat: '◈ {amount} Vasos',
  defaultInitialBalance: 999999,
  isUnlimitedBeta: true,
};

export function formatVasos(amount) {
  const num = Number(amount || 0);
  return `${num} ◈ Vasos`;
}

export default TOKEN_CONFIG;
