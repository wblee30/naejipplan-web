// 주택 매수 부대비용 — 앱 lib/logic/costs.dart를 그대로 옮긴 것.
// 1주택 유상취득 일반 세율 기준이며 다주택·법인 중과는 반영하지 않는다.

export const costsAsOf = '2026-10 기준';

/// 생애최초 주택 취득세 감면: 취득가 12억원 이하, 최대 200만원 (2028.12.31까지)
export const firstTimeReductionPriceLimit = 1200000000;
export const firstTimeReductionMax = 2000000;

/// 취득세율 (1주택 유상취득): 6억 이하 1%, 6~9억 (가격 × 2/3억 − 3)% (0.01%p 단위 반올림), 9억 초과 3%
export function acquisitionTaxRate(price) {
  if (price <= 600000000) return 0.01;
  if (price <= 900000000) {
    const ratePercent = price * 2 / 300000000 - 3;
    return Math.round(ratePercent * 100) / 100 / 100;
  }
  return 0.03;
}

/// 중개보수 상한 (주택 매매, 2021.10 개정 요율표, 부가세 별도)
export function brokerageFee(price) {
  if (price < 50000000) return Math.min(price * 0.006, 250000);
  if (price < 200000000) return Math.min(price * 0.005, 800000);
  if (price < 900000000) return price * 0.004;
  if (price < 1200000000) return price * 0.005;
  if (price < 1500000000) return price * 0.006;
  return price * 0.007;
}

/// 인지세 (매매계약서): 1억 이하 없음, 1억 초과~10억 15만원, 10억 초과 35만원
export function stampTax(price) {
  if (price <= 100000000) return 0;
  if (price <= 1000000000) return 150000;
  return 350000;
}

export function calculateAcquisitionCosts({ price, isSmallHouse = true, firstTimeBuyer = false }) {
  const taxRate = acquisitionTaxRate(price);
  const grossTax = price * taxRate;
  const reduction = firstTimeBuyer && price <= firstTimeReductionPriceLimit
    ? Math.min(grossTax, firstTimeReductionMax)
    : 0;
  const acquisitionTax = grossTax - reduction;
  const localEducationTax = price * taxRate / 10; // 취득세율의 1/10
  const ruralSpecialTax = isSmallHouse ? 0 : price * 0.002; // 85㎡ 초과 0.2%
  const bondDiscount = price * 0.026 * 0.10; // 국민주택채권 즉시 매도 할인 비용 근사
  const brokerage = brokerageFee(price);
  const stamp = stampTax(price);
  const totalTax = acquisitionTax + localEducationTax + ruralSpecialTax;
  return {
    taxRate,
    acquisitionTax,
    acquisitionTaxReduction: reduction,
    localEducationTax,
    ruralSpecialTax,
    brokerageFee: brokerage,
    stampTax: stamp,
    bondDiscount,
    totalTax,
    total: totalTax + brokerage + stamp + bondDiscount,
  };
}
