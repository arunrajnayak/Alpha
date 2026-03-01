export interface TargetHolding {
  symbol: string;
  sector?: string;
  
  // Current state (readonly)
  currentQty: number;
  currentValue: number;
  currentWeight: number;
  
  // Target state (editable)
  targetQty: number;
  targetWeight: number;
  
  // Price
  price: number; // LTP
  
  // Flags
  isLocked: boolean;
  isNew: boolean; // Added via search, not in current portfolio
}

export interface RebalanceAction {
  symbol: string;
  action: 'BUY' | 'SELL';
  qty: number;
  value: number; // qty * price
  currentQty: number;
  targetQty: number;
}

export interface RebalanceSummary {
  actions: RebalanceAction[];
  totalBuyValue: number;
  totalSellValue: number;
  netCashImpact: number; // negative = need to invest, positive = will receive
  warnings: string[];
}

export interface RebalanceState {
  holdings: TargetHolding[];
  cashflow: number; // positive = deposit, negative = withdrawal
  totalEquity: number; // original portfolio value
  effectiveEquity: number; // totalEquity + cashflow
  diffThreshold: number; // % difference threshold to ignore trades
}

// Re-export from types for convenience
import { RebalanceInputHolding } from './types';
export type { RebalanceInputHolding };


const MIN_TRADE_VALUE = 100; // Skip trades under ₹100
const TOTAL_WEIGHT_TOLERANCE = 1; // Ignore total weight drift under +/-1%

export function initializeRebalanceState(
  currentHoldings: RebalanceInputHolding[],
  totalEquity: number
): RebalanceState {
  const holdings: TargetHolding[] = currentHoldings.map(h => ({
    symbol: h.symbol,
    sector: h.sector,
    currentQty: h.quantity,
    currentValue: h.currentValue,
    currentWeight: totalEquity > 0 ? (h.currentValue / totalEquity) * 100 : 0,
    targetQty: h.quantity,
    targetWeight: totalEquity > 0 ? (h.currentValue / totalEquity) * 100 : 0,
    price: h.price,
    isLocked: false,
    isNew: false,
  }));

  return {
    holdings,
    cashflow: 0,
    totalEquity,
    effectiveEquity: totalEquity,
    diffThreshold: 0,
  };
}

export function recalculateOnWeightChange(
  state: RebalanceState,
  changedSymbol: string,
  newWeight: number
): RebalanceState {
  /**
   * When user changes a stock's weight:
   * 1. Set the new weight for the changed stock
   * 2. Calculate remaining weight for unlocked stocks
   * 3. Distribute remaining weight proportionally among other unlocked stocks
   * 4. Recalculate all target quantities based on new weights
   */
  
  const { holdings, effectiveEquity } = state;
  const changedHolding = holdings.find(h => h.symbol === changedSymbol);
  
  if (!changedHolding) return state;

  // Clamp weight between 0 and 100
  const clampedWeight = Math.max(0, Math.min(100, newWeight));
  
  // Get locked weight (excluding the changed stock if it's not locked)
  const lockedWeight = holdings
    .filter(h => h.isLocked && h.symbol !== changedSymbol)
    .reduce((sum, h) => sum + h.targetWeight, 0);
  
  // Maximum weight this stock can have
  const maxAllowedWeight = 100 - lockedWeight;
  const finalWeight = Math.min(clampedWeight, maxAllowedWeight);
  
  // Weight available for other unlocked stocks
  const remainingWeight = 100 - lockedWeight - finalWeight;
  
  // Get other unlocked stocks
  const otherUnlocked = holdings.filter(
    h => !h.isLocked && h.symbol !== changedSymbol
  );
  
  // Sum of current weights of other unlocked stocks (for proportional distribution)
  const otherUnlockedWeightSum = otherUnlocked.reduce(
    (sum, h) => sum + h.targetWeight, 0
  );

  const updatedHoldings = holdings.map(h => {
    if (h.symbol === changedSymbol) {
      // The stock being changed
      const targetValue = (finalWeight / 100) * effectiveEquity;
      const roundedQty = Math.round(targetValue / h.price);
      return {
        ...h,
        targetWeight: finalWeight,
        targetQty: roundedQty,
      };
    } else if (h.isLocked) {
      // Locked stocks - only recalc qty based on effective equity
      const targetValue = (h.targetWeight / 100) * effectiveEquity;
      const roundedQty = Math.round(targetValue / h.price);
      return {
        ...h,
        targetQty: roundedQty,
      };
    } else {
      // Other unlocked stocks - distribute remaining weight proportionally
      let newTargetWeight: number;
      if (otherUnlockedWeightSum > 0) {
        newTargetWeight = (h.targetWeight / otherUnlockedWeightSum) * remainingWeight;
      } else {
        // If all others were at 0%, distribute equally
        newTargetWeight = otherUnlocked.length > 0 ? remainingWeight / otherUnlocked.length : 0;
      }
      
      const targetValue = (newTargetWeight / 100) * effectiveEquity;
      const roundedQty = Math.round(targetValue / h.price);
      return {
        ...h,
        targetWeight: newTargetWeight,
        targetQty: roundedQty,
      };
    }
  });

  return { ...state, holdings: updatedHoldings };
}

export function recalculateOnQtyChange(
  state: RebalanceState,
  changedSymbol: string,
  newQty: number
): RebalanceState {
  /**
   * When user changes a stock's quantity:
   * 1. Calculate the new weight based on qty * price
   * 2. Delegate to weight change logic for proportional adjustment
   */
  
  const { holdings, effectiveEquity } = state;
  const changedHolding = holdings.find(h => h.symbol === changedSymbol);
  
  if (!changedHolding) return state;

  const newValue = newQty * changedHolding.price;
  const newWeight = (newValue / effectiveEquity) * 100;

  return recalculateOnWeightChange(state, changedSymbol, newWeight);
}

export function recalculateOnCashflowChange(
  state: RebalanceState,
  newCashflow: number
): RebalanceState {
  /**
   * When cashflow changes:
   * 1. Update effective equity
   * 2. Recalculate all target quantities based on current weights
   *    (weights stay the same, quantities scale with new equity)
   */
  
  const { holdings, totalEquity } = state;
  
  // Prevent withdrawal > portfolio value
  const minCashflow = -totalEquity; // Allow 100% withdrawal (exit all)
  const safeCashflow = Math.max(minCashflow, newCashflow);
  
  const effectiveEquity = totalEquity + safeCashflow;

  const updatedHoldings = holdings.map(h => {
    const targetValue = (h.targetWeight / 100) * effectiveEquity;
    return {
      ...h,
    targetQty: Math.round(targetValue / h.price),
  };
});

  return {
    ...state,
    cashflow: safeCashflow,
    effectiveEquity,
    holdings: updatedHoldings,
  };
}

export function applyEquiweight(state: RebalanceState): RebalanceState {
  /**
   * Equal-weight distribution:
   * 1. Calculate total locked weight
   * 2. If all stocks locked, return unchanged (no-op)
   * 3. Distribute remaining weight equally among unlocked stocks
   * 4. Recalculate quantities
   */
  
  const { holdings, effectiveEquity } = state;
  
  const lockedHoldings = holdings.filter(h => h.isLocked);
  const unlockedHoldings = holdings.filter(h => !h.isLocked);
  
  // No-op if all stocks are locked
  if (unlockedHoldings.length === 0) {
    return state;
  }
  
  const lockedWeight = lockedHoldings.reduce((sum, h) => sum + h.targetWeight, 0);
  const remainingWeight = 100 - lockedWeight;
  const equalWeight = remainingWeight / unlockedHoldings.length;

  const updatedHoldings = holdings.map(h => {
    if (h.isLocked) {
      // Locked - keep weight, recalc qty for effective equity
      const targetValue = (h.targetWeight / 100) * effectiveEquity;
      return { ...h, targetQty: Math.round(targetValue / h.price) };
    } else {
      // Unlocked - apply equal weight
      const targetValue = (equalWeight / 100) * effectiveEquity;
      return {
        ...h,
        targetWeight: equalWeight,
        targetQty: Math.round(targetValue / h.price),
      };
    }
  });

  return { ...state, holdings: updatedHoldings };
}

export function addStock(
  state: RebalanceState,
  symbol: string,
  price: number,
  sector?: string
): RebalanceState {
  /**
   * Add new stock:
   * 1. Add with 0 weight/qty
   * 2. User will then adjust weight or use Equiweight
   */
  
  // Check if already exists
  if (state.holdings.some(h => h.symbol === symbol)) {
    return state;
  }

  const newHolding: TargetHolding = {
    symbol,
    sector,
    currentQty: 0,
    currentValue: 0,
    currentWeight: 0,
    targetQty: 0,
    targetWeight: 0,
    price,
    isLocked: false,
    isNew: true,
  };

  return {
    ...state,
    holdings: [...state.holdings, newHolding],
  };
}

export function removeStock(
  state: RebalanceState,
  symbol: string
): RebalanceState {
  /**
   * Remove stock:
   * 1. Set target weight to 0 (will generate SELL action)
   * 2. If it's a new stock (not in portfolio), remove entirely
   */
  
  const holding = state.holdings.find(h => h.symbol === symbol);
  if (!holding) return state;

  if (holding.isNew) {
    // New stock - just remove from list
    return {
      ...state,
      holdings: state.holdings.filter(h => h.symbol !== symbol),
    };
  } else {
    // Existing stock - set to 0 and redistribute weight
    return recalculateOnWeightChange(state, symbol, 0);
  }
}

export function toggleLock(
  state: RebalanceState,
  symbol: string
): RebalanceState {
  const updatedHoldings = state.holdings.map(h =>
    h.symbol === symbol ? { ...h, isLocked: !h.isLocked } : h
  );
  return { ...state, holdings: updatedHoldings };
}

export function resetToOriginal(
  originalHoldings: RebalanceInputHolding[],
  totalEquity: number
): RebalanceState {
  return initializeRebalanceState(originalHoldings, totalEquity);
}

export function calculateSummary(state: RebalanceState): RebalanceSummary {
  const { holdings, diffThreshold } = state;
  const actions: RebalanceAction[] = [];
  const warnings: string[] = [];

  const thresholdFraction = Number.isFinite(diffThreshold) ? diffThreshold : 0;
  const thresholdPct = thresholdFraction * 100;

  for (const h of holdings) {
    const qtyDiff = h.targetQty - h.currentQty;
    const value = Math.abs(qtyDiff * h.price);

    // Apply per-stock threshold based on model weights (fraction -> percent points)
    // Always include explicit additions/removals regardless of threshold.
    const diffWeightPct = Math.abs(h.targetWeight - h.currentWeight);
    const bypassThreshold = h.isNew || h.targetWeight === 0;
    if (!bypassThreshold && diffWeightPct < thresholdPct) continue;

    // Skip if no quantity change
    if (Math.abs(qtyDiff) === 0) continue;
    
    // Skip small trades (but warn)
    if (value < MIN_TRADE_VALUE) {
      warnings.push(`${h.symbol}: Trade value ₹${value.toFixed(0)} below minimum threshold`);
      continue;
    }

    actions.push({
      symbol: h.symbol,
      action: qtyDiff > 0 ? 'BUY' : 'SELL',
      qty: Math.abs(qtyDiff),
      value,
      currentQty: h.currentQty,
      targetQty: h.targetQty,
    });
  }

  const totalBuyValue = actions
    .filter(a => a.action === 'BUY')
    .reduce((sum, a) => sum + a.value, 0);

  const totalSellValue = actions
    .filter(a => a.action === 'SELL')
    .reduce((sum, a) => sum + a.value, 0);

  // Negative = need to invest more, Positive = will get cash back
  const netCashImpact = totalSellValue - totalBuyValue;

  // Validate
  const totalWeight = holdings.reduce((sum, h) => sum + h.targetWeight, 0);
  if (Math.abs(totalWeight - 100) >= TOTAL_WEIGHT_TOLERANCE && holdings.length > 0) {
     // Ignore minor drift under +/-1%
    warnings.push(`Total weight is ${totalWeight.toFixed(1)}%, should be 100%`);
  }

  return {
    actions,
    totalBuyValue,
    totalSellValue,
    netCashImpact,
    warnings,
  };
}

export function setDiffThreshold(
  state: RebalanceState,
  threshold: number
): RebalanceState {
  return {
    ...state,
    diffThreshold: threshold,
  };
}
