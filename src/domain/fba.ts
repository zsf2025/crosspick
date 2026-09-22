/**
 * 亚马逊美国站 FBA 费用近似模型。
 * 费率为公开区间的近似值，仅用于选品阶段快速测算，不用于财务核算。
 */
export interface FbaConfig {
  /** 平台佣金比例，多数类目 15% */
  referralRate: number
  /** 头程物流 USD/kg */
  inboundPerKg: number
  /** 履约费档位：重量 <= maxKg 时取 fee（按 maxKg 升序匹配） */
  fulfillmentTiers: Array<{ maxKg: number; fee: number }>
  /** 定价时追求的目标毛利率 */
  targetMargin: number
}

export const DEFAULT_FBA_CONFIG: FbaConfig = {
  referralRate: 0.15,
  inboundPerKg: 1.6,
  fulfillmentTiers: [
    { maxKg: 0.25, fee: 3.22 },
    { maxKg: 0.5, fee: 3.86 },
    { maxKg: 1, fee: 5.35 },
    { maxKg: 2, fee: 6.94 },
    { maxKg: 5, fee: 10.53 },
    { maxKg: Infinity, fee: 10.53 + 0.38 * 5 },
  ],
  targetMargin: 0.4,
}

export function fbaFulfillmentFee(weightKg: number, cfg: FbaConfig = DEFAULT_FBA_CONFIG): number {
  const w = Math.max(0, weightKg)
  for (const t of cfg.fulfillmentTiers) {
    if (w <= t.maxKg) return t.fee
  }
  const last = cfg.fulfillmentTiers[cfg.fulfillmentTiers.length - 1]
  return last ? last.fee : 0
}

export function inboundCost(weightKg: number, cfg: FbaConfig = DEFAULT_FBA_CONFIG): number {
  return Math.max(0, weightKg) * cfg.inboundPerKg
}

/** 与销量无关的单件固定成本：采购 + 头程 + 履约费 */
export function unitFixedCost(
  purchaseCost: number,
  weightKg: number,
  cfg: FbaConfig = DEFAULT_FBA_CONFIG,
): number {
  return purchaseCost + inboundCost(weightKg, cfg) + fbaFulfillmentFee(weightKg, cfg)
}

/**
 * 盈亏平衡售价：P × (1 - 佣金率) = 单件固定成本
 * 佣金按售价抽成，所以必须解方程而不是简单加价。
 */
export function breakEvenPrice(
  purchaseCost: number,
  weightKg: number,
  cfg: FbaConfig = DEFAULT_FBA_CONFIG,
): number {
  const fixed = unitFixedCost(purchaseCost, weightKg, cfg)
  const keep = 1 - cfg.referralRate
  if (keep <= 0) return fixed
  return fixed / keep
}

/** 单件净利 */
export function unitProfit(
  price: number,
  purchaseCost: number,
  weightKg: number,
  cfg: FbaConfig = DEFAULT_FBA_CONFIG,
): number {
  const fixed = unitFixedCost(purchaseCost, weightKg, cfg)
  return price * (1 - cfg.referralRate) - fixed
}

/** 达到目标毛利率所需售价 */
export function priceForMargin(
  purchaseCost: number,
  weightKg: number,
  margin: number,
  cfg: FbaConfig = DEFAULT_FBA_CONFIG,
): number {
  const fixed = unitFixedCost(purchaseCost, weightKg, cfg)
  const keep = 1 - cfg.referralRate
  if (keep <= 0) return fixed
  return fixed / (keep * (1 - margin))
}
