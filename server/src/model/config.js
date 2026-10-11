// Model configuration: every material assumption of the customer/demand model and the Store Brain.
// A copy of this object is frozen into runs.config_json when a run starts, so each run documents
// the exact assumptions that produced it. Change a value here -> start a NEW run.

export const MODEL_VERSION = 'v1.0';

export const DEFAULT_CONFIG = {
  modelVersion: MODEL_VERSION,
  horizonDays: 60,
  openingCash: 15000,
  inventoryBudget: 40000,
  calendar: {
    // Simulated calendar only (no real dates/public holidays): Day 1 is a Monday.
    day1Weekday: 'Mon',
    storeOpenHour: 7,
    storeCloseHour: 22,
  },

  openingInventory: {
    // Opening quantity = planner's daily estimate x cover days, rounded UP to whole supplier cases.
    nonPerishableCoverDays: 28,
    minCases: 1, // shelf presentation minimum: at least one full case of every product
    perishableCoverDays: 2, // capped at shelf life (a 1-day item gets 1 day)
  },

  customers: {
    // Mean store visits per day at full trading (after the opening ramp).
    baseWeekday: 540,
    baseWeekend: 380,
    // Day-of-week multipliers on the weekday/weekend base.
    dowFactor: { Mon: 0.92, Tue: 0.98, Wed: 1.0, Thu: 1.04, Fri: 1.08, Sat: 1.06, Sun: 0.94 },
    // New-store awareness ramp: traffic starts at rampStart x base and rises linearly to 100% by rampDays.
    rampStart: 0.7,
    rampDays: 14,
    // Day-level random variation (log-normal sigma) - weather, events, etc. not modelled explicitly.
    dailyNoiseSigma: 0.07,
  },

  // Shopping missions. Mix differs between weekdays (office workers/commuters) and weekends
  // (residents, students, visitors). Each mission has its own basket size, category preferences
  // and time-of-day profile.
  missions: {
    COMMUTER: {
      label: 'Commuter grab-and-go',
      mix: { weekday: 0.22, weekend: 0.07 },
      lines: { min: 1, max: 2, mean: 1.4 },
      categories: { DRK: 0.35, BAK: 0.22, RTE: 0.2, SNK: 0.08, DAI: 0.1, FRS: 0.05 },
      hours: { 7: 22, 8: 30, 9: 20, 10: 8, 11: 3, 12: 2, 13: 2, 14: 2, 15: 2, 16: 3, 17: 4, 18: 2 },
    },
    LUNCH: {
      label: 'Lunch run',
      mix: { weekday: 0.3, weekend: 0.2 },
      lines: { min: 1, max: 3, mean: 1.9 },
      categories: { RTE: 0.52, DRK: 0.25, SNK: 0.1, FRS: 0.08, BAK: 0.05 },
      hours: { 11: 14, 12: 38, 13: 32, 14: 12, 15: 4 },
    },
    SNACK: {
      label: 'Snack & drink top-up',
      mix: { weekday: 0.2, weekend: 0.28 },
      lines: { min: 1, max: 2, mean: 1.3 },
      categories: { SNK: 0.45, DRK: 0.45, FRS: 0.05, BAK: 0.05 },
      hours: { 7: 3, 8: 5, 9: 5, 10: 7, 11: 7, 12: 8, 13: 9, 14: 10, 15: 11, 16: 10, 17: 9, 18: 7, 19: 5, 20: 3, 21: 1 },
    },
    DINNER_TOPUP: {
      label: 'Dinner / top-up shop',
      mix: { weekday: 0.22, weekend: 0.3 },
      lines: { min: 2, max: 6, mean: 3.4 },
      categories: { DAI: 0.22, PAN: 0.12, FRS: 0.17, BAK: 0.1, RTE: 0.17, DRK: 0.11, SNK: 0.095, HHP: 0.015 },
      hours: { 10: 1, 11: 1, 12: 2, 13: 2, 14: 2, 15: 3, 16: 9, 17: 20, 18: 24, 19: 18, 20: 12, 21: 6 },
    },
    STOCK_UP: {
      label: 'Household stock-up',
      mix: { weekday: 0.06, weekend: 0.15 },
      lines: { min: 4, max: 9, mean: 5.5 },
      categories: { PAN: 0.2, HHP: 0.1, DAI: 0.2, FRS: 0.15, DRK: 0.13, SNK: 0.1, BAK: 0.12 },
      hours: { 9: 4, 10: 10, 11: 12, 12: 12, 13: 12, 14: 10, 15: 10, 16: 8, 17: 8, 18: 7, 19: 5, 20: 2 },
    },
  },

  quantity: {
    // Probability a line is for 2 units (same product); multi-unit "each" products draw 1-4 units.
    twoUnitProb: { DRK: 0.15, SNK: 0.12, default: 0.06, STOCK_UP: 0.25 },
    multiUnitRange: [1, 4],
  },

  substitution: {
    // If the chosen product is unavailable, probability the customer accepts another product
    // from the same category; otherwise the demand is lost (recorded in lost_sales).
    acceptProb: { DRK: 0.7, SNK: 0.6, RTE: 0.5, BAK: 0.45, DAI: 0.5, FRS: 0.4, PAN: 0.35, HHP: 0.25 },
  },

  storeBrain: {
    forecastWindowDays: 7, // trailing sales window
    priorWeightDays: 2, // planner estimate counts as this many days of evidence
    censoredUplift: 1.25, // a day that sold out understates demand; scale it up in the forecast
    nonPerishable: { reorderPointDays: 4, orderUpToDays: 10, lowStockDays: 2 },
    perishable: { maxCoverDays: 3, safetyFactor: 0.15, lowStockDays: 1 },
    slowMover: { minDay: 10, lookbackDays: 14, coverDaysThreshold: 30, refreshEveryDays: 7 },
    waste: { lookbackDays: 7, highWasteRate: 0.15, stepDown: 0.9, minFactor: 0.6, stepUp: 1.1 },
    cashReserve: 1000, // minimum operating cash the Brain keeps unspent
    nearExpiryWarnDays: 1, // warn on the morning of a batch's last saleable day
  },
};
