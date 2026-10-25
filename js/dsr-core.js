// 스트레스 DSR 계산 로직 — 앱(lib/logic/dsr.dart, lib/logic/loan_math.dart,
// lib/data/regulations.dart)을 그대로 옮긴 것. 규제 수치를 바꿀 때는 앱과 함께 갱신한다.
// 단위: 금액은 원, 금리는 %(연), 기간은 개월.

export const regulationsAsOf = '2026-10 기준';
export const regulationsVerifiedAt = '2026-10-01';

export const bankDsrLimitPercent = 40;
const dsrBulletMaxYears = 10;
const dsrCreditMaxYears = 5;

export const Region = {
  regulated: { key: 'regulated', label: '규제지역', description: '서울 전역·경기 15곳 (투기과열지구·조정대상지역)' },
  capitalArea: { key: 'capitalArea', label: '수도권 비규제', description: '규제지역이 아닌 수도권' },
  nonCapital: { key: 'nonCapital', label: '지방', description: '수도권 외 지역' },
};

export const Buyer = {
  homeless: { key: 'homeless', label: '무주택' },
  firstTime: { key: 'firstTime', label: '생애최초' },
  oneHome: { key: 'oneHome', label: '1주택 (처분조건)' },
};

export const RateType = {
  variable: { key: 'variable', label: '변동형', needsFixedYears: false },
  mixed: { key: 'mixed', label: '혼합형', needsFixedYears: true },
  periodic: { key: 'periodic', label: '주기형', needsFixedYears: true },
  fixed: { key: 'fixed', label: '고정형', needsFixedYears: false },
};

export const Method = {
  amortization: { key: 'amortization', label: '원리금 균등' },
  equalPrincipal: { key: 'equalPrincipal', label: '원금 균등' },
  bullet: { key: 'bullet', label: '만기 일시' },
};

/// 스트레스 금리 반영비율 (은행권 주담대, 금융위 2025.7 3단계 시행방안 표3).
/// 고정기간 5년 미만은 변동형과 같이 100%. 지방 주담대는 2단계 비율(stage2).
export function stressReflectRatio(type, { fixedYears = 0, loanYears = 30, stage2 = false } = {}) {
  switch (type) {
    case 'variable':
      return 1.0;
    case 'fixed':
      return 0.0;
    case 'mixed':
    case 'periodic': {
      if (fixedYears < 5) return 1.0;
      const share = loanYears <= 0 ? 1.0 : fixedYears / loanYears;
      if (share >= 0.7) return 0.0;
      const step = share < 0.3 ? 0 : share < 0.5 ? 1 : 2;
      const ratios = type === 'mixed'
        ? (stage2 ? [0.6, 0.4, 0.2] : [0.8, 0.6, 0.4])
        : (stage2 ? [0.3, 0.2, 0.1] : [0.4, 0.3, 0.2]);
      return ratios[step];
    }
    default:
      throw new Error(`unknown rate type: ${type}`);
  }
}

/// 수도권·규제지역 주택구입 주담대 금액 상한 (시가 구간별, 2025.10.16~)
export function capitalAreaLoanCap(price) {
  if (price <= 1500000000) return 600000000;
  if (price <= 2500000000) return 400000000;
  return 200000000;
}

/// 규제지역 서민·실수요자 LTV 우대 요건 (부부합산 9천만원 이하, 주택 8억원 이하)
export function isLowIncomeRealDemand({ annualIncome, price }) {
  return annualIncome > 0 && annualIncome <= 90000000 && price <= 800000000;
}

function eok(won) {
  const v = won / 100000000;
  return Number.isInteger(v) ? `${v}억원` : `${v.toFixed(1)}억원`;
}

/// 지역·매수자·주택가격(·연소득)에 맞는 규제값
export function regulationFor({ region, buyer, price, annualIncome = 0 }) {
  const firstTime = buyer === 'firstTime';
  const oneHomeNote = buyer === 'oneHome'
    ? '1주택자는 기존 주택 6개월 내 처분 조건 (미이행 시 대출 회수)'
    : null;
  const capNote = (p) =>
    `주담대 한도 ${eok(capitalAreaLoanCap(p))} (시가 15억 이하 6억 · 25억 이하 4억 · 초과 2억)`;
  let reg;
  switch (region) {
    case 'regulated': {
      const realDemand = !firstTime && buyer === 'homeless' &&
        isLowIncomeRealDemand({ annualIncome, price });
      const ltv = firstTime ? 70 : realDemand ? 60 : 40;
      reg = {
        ltvPercent: ltv,
        dsrPercent: bankDsrLimitPercent,
        baseStressRate: 3.0,
        loanCap: capitalAreaLoanCap(price),
        maxYears: 30,
        stage2Ratios: false,
        notes: [
          firstTime ? '규제지역 생애최초 LTV 70% (6개월 내 전입)'
            : realDemand ? '서민·실수요자 LTV 60% (부부합산 9천만원·주택 8억원 이하)'
            : '규제지역 LTV 40%',
          capNote(price),
          '스트레스 금리 3%p (수도권·규제지역)',
          '만기 최장 30년',
        ],
      };
      break;
    }
    case 'capitalArea':
      reg = {
        ltvPercent: 70,
        dsrPercent: bankDsrLimitPercent,
        baseStressRate: 3.0,
        loanCap: capitalAreaLoanCap(price),
        maxYears: 30,
        stage2Ratios: false,
        notes: [
          firstTime ? '생애최초 LTV 70% (수도권은 일반과 동일)' : 'LTV 70%',
          capNote(price),
          '스트레스 금리 3%p (수도권·규제지역)',
          '만기 최장 30년',
        ],
      };
      break;
    case 'nonCapital':
      reg = {
        ltvPercent: firstTime ? 80 : 70,
        dsrPercent: bankDsrLimitPercent,
        baseStressRate: 0.75,
        loanCap: null,
        maxYears: null,
        stage2Ratios: true,
        notes: [
          firstTime ? '지방 생애최초 LTV 80%' : '지방 LTV 70%',
          '스트레스 금리 0.75%p, 혼합형·주기형 반영비율 2단계 (지방 주담대 완화, 2026.12.31까지)',
        ],
      };
      break;
    default:
      throw new Error(`unknown region: ${region}`);
  }
  if (oneHomeNote) reg.notes.push(oneHomeNote);
  reg.stressRateFor = (type, { fixedYears = 0, loanYears = 30 } = {}) =>
    reg.baseStressRate *
    stressReflectRatio(type, { fixedYears, loanYears, stage2: reg.stage2Ratios });
  return reg;
}

/// 첫 12개월 납입액 합계 (원리금 균등·원금 균등, 거치 없음).
/// 앱의 calculateLoan 스케줄 앞 12회차 합과 같다.
function firstYearPayments(principal, annualRate, months, method) {
  const r = annualRate / 100 / 12;
  const n = Math.min(12, months);
  let balance = principal;
  let sum = 0;
  if (method === 'equalPrincipal') {
    const per = principal / months;
    for (let m = 1; m <= n; m++) {
      const principalPaid = m === months ? balance : per;
      sum += principalPaid + balance * r;
      balance -= principalPaid;
    }
    return sum;
  }
  let payment;
  if (r === 0) {
    payment = principal / months;
  } else {
    const pow = Math.pow(1 + r, months);
    payment = principal * r * pow / (pow - 1);
  }
  for (let m = 1; m <= n; m++) {
    const interest = balance * r;
    let principalPaid = payment - interest;
    if (m === months || principalPaid > balance) principalPaid = balance;
    balance -= principalPaid;
    sum += principalPaid + interest;
  }
  return sum;
}

/// DSR 산정용 연간 원리금 상환액.
/// 분할상환: 첫 12개월 납입액 합계. 만기일시: 대출총액 ÷ min(기간, 10년) + 연 이자.
export function dsrAnnualDebtService({
  principal, annualRate, months, method = 'amortization', stressRatePercent = 0,
}) {
  if (principal <= 0 || months <= 0) return 0;
  const rate = annualRate + stressRatePercent;
  if (method === 'bullet') {
    const years = Math.min(months / 12, dsrBulletMaxYears);
    const principalPart = years >= 1 ? principal / years : principal;
    const interestPart = principal * rate / 100 * Math.min(1, months / 12);
    return principalPart + interestPart;
  }
  return firstYearPayments(principal, rate, months, method);
}

/// 기타 대출 연간 원리금 (DSR 산정용 근사).
/// 신용대출(만기일시·마이너스통장): 실제 만기와 관계없이 원금 ÷ 5년 + 1년치 이자 (신용대출 DSR 산정만기 5년 일괄).
/// 그 외 분할상환: 원리금 균등 다음 12개월 납입액.
export function otherLoanAnnualDebtService({ balance, annualRate, remainingMonths, isCredit = false }) {
  if (balance <= 0) return 0;
  if (isCredit) return balance / dsrCreditMaxYears + balance * annualRate / 100;
  if (remainingMonths <= 0) return 0;
  return dsrAnnualDebtService({ principal: balance, annualRate, months: remainingMonths });
}

/// DSR 한도 내 최대 대출액 (이분 탐색)
export function maxLoanByDsr({ annualIncome, annualRate, months, method = 'amortization',
  dsrLimitPercent = bankDsrLimitPercent, stressRatePercent = 0, otherAnnual = 0 }) {
  const budget = annualIncome * dsrLimitPercent / 100 - otherAnnual;
  if (budget <= 0 || months <= 0) return 0;
  let lo = 0;
  let hi = budget * Math.max(months / 12, 1) + 1;
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2;
    const annual = dsrAnnualDebtService({ principal: mid, annualRate, months, method, stressRatePercent });
    if (annual <= budget) lo = mid; else hi = mid;
  }
  return lo;
}

/// LTV / DSR 계산 (앱 calculateDsrLtv와 동일)
export function calculateDsrLtv({
  annualIncome, propertyPrice, loanAmount, annualRate, months,
  otherLoans = [], method = 'amortization', ltvLimitPercent = 70,
  dsrLimitPercent = bankDsrLimitPercent, stressRatePercent = 0, loanCap = null,
}) {
  const annualFor = (p, s) => dsrAnnualDebtService({
    principal: p, annualRate, months, method, stressRatePercent: s,
  });
  const newAnnual = annualFor(loanAmount, stressRatePercent);
  const newAnnualNominal = annualFor(loanAmount, 0);
  const otherAnnual = otherLoans.reduce((s, l) => s + otherLoanAnnualDebtService(l), 0);

  const dsr = annualIncome > 0 ? (newAnnual + otherAnnual) / annualIncome * 100 : Infinity;
  const dsrNominal = annualIncome > 0 ? (newAnnualNominal + otherAnnual) / annualIncome * 100 : Infinity;
  const ltv = propertyPrice > 0 ? loanAmount / propertyPrice * 100 : 0;

  const maxByLtv = propertyPrice * ltvLimitPercent / 100;
  const maxByDsr = maxLoanByDsr({
    annualIncome, annualRate, months, method, dsrLimitPercent, stressRatePercent, otherAnnual,
  });

  let maxLoan = Math.min(maxByLtv, maxByDsr);
  let limitingFactor = maxByLtv <= maxByDsr ? 'LTV' : 'DSR';
  if (loanCap != null && loanCap < maxLoan) {
    maxLoan = loanCap;
    limitingFactor = '금액 상한';
  }
  return {
    newLoanAnnualPayment: newAnnual,
    newLoanAnnualPaymentNominal: newAnnualNominal,
    otherAnnualPayment: otherAnnual,
    dsrPercent: dsr,
    dsrPercentNominal: dsrNominal,
    ltvPercent: ltv,
    stressRatePercent,
    maxLoanByLtv: maxByLtv,
    maxLoanByDsr: maxByDsr,
    loanCap,
    maxLoan,
    limitingFactor,
  };
}

/// 화면 입력 한 벌로 규제 적용 → 결과 + 스트레스 미적용 비교 + 금리 유형별 한도까지 계산.
/// 앱 dsr_screen.dart의 자동 규제 모드와 같은 흐름.
export function evaluate({
  region, buyer, annualIncome, propertyPrice, loanAmount, annualRate,
  years, method = 'amortization', rateType = 'variable', fixedYears = 5, otherLoans = [],
}) {
  const reg = regulationFor({ region, buyer, price: propertyPrice, annualIncome });
  const enteredMonths = Math.round(years * 12);
  const months = reg.maxYears != null ? Math.min(enteredMonths, reg.maxYears * 12) : enteredMonths;
  const loanYears = Math.floor(months / 12);
  const common = {
    annualIncome, propertyPrice, loanAmount, annualRate, months, otherLoans, method,
    ltvLimitPercent: reg.ltvPercent, dsrLimitPercent: reg.dsrPercent, loanCap: reg.loanCap,
  };
  const stress = reg.stressRateFor(rateType, { fixedYears, loanYears });
  const result = calculateDsrLtv({ ...common, stressRatePercent: stress });
  const noStress = calculateDsrLtv({ ...common, stressRatePercent: 0 });

  // 금리 유형별 비교 (혼합·주기형은 입력한 고정기간 기준)
  const byRateType = Object.keys(RateType).map((t) => {
    const s = reg.stressRateFor(t, { fixedYears, loanYears });
    const r = calculateDsrLtv({ ...common, stressRatePercent: s });
    return { rateType: t, stressRatePercent: s, maxLoanByDsr: r.maxLoanByDsr, maxLoan: r.maxLoan, limitingFactor: r.limitingFactor };
  });

  return { regulation: reg, months, enteredMonths, stress, result, noStress, byRateType };
}
