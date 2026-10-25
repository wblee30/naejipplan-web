// 상환 스케줄·중도상환·대환 계산 — 앱 lib/logic/loan_math.dart를 그대로 옮긴 것.
// 계산 규칙을 바꿀 때는 앱과 함께 고치고 site/test/loan-core.test.mjs를 갱신한다.
// 단위: 금액은 원, 금리는 %(연), 기간은 개월. 상환 방식: 'amortization' | 'equalPrincipal' | 'bullet'

/// 상환 스케줄. 원리금 균등·원금 균등·만기 일시, 거치 기간(이자만 납부) 지원.
export function calculateLoan({ principal, annualRate, months, method = 'amortization', graceMonths = 0 }) {
  const r = annualRate / 100 / 12;
  const schedule = [];
  let balance = principal;

  if (method === 'bullet') {
    for (let m = 1; m <= months; m++) {
      const interest = balance * r;
      const isLast = m === months;
      const principalPaid = isLast ? balance : 0;
      schedule.push({ month: m, payment: interest + principalPaid, principal: principalPaid, interest, balance: isLast ? 0 : balance });
    }
  } else {
    const grace = Math.max(0, Math.min(graceMonths, months - 1));
    for (let m = 1; m <= grace; m++) {
      const interest = balance * r;
      schedule.push({ month: m, payment: interest, principal: 0, interest, balance });
    }
    if (method === 'amortization') {
      const n = months - grace;
      const payment = r === 0 ? balance / n : (balance * r * (1 + r) ** n) / ((1 + r) ** n - 1);
      for (let m = grace + 1; m <= months; m++) {
        const interest = balance * r;
        let principalPaid = payment - interest;
        if (m === months || principalPaid > balance) principalPaid = balance;
        balance -= principalPaid;
        schedule.push({ month: m, payment: principalPaid + interest, principal: principalPaid, interest, balance });
      }
    } else {
      const n = months - grace;
      const per = balance / n;
      for (let m = 1; m <= n; m++) {
        const interest = balance * r;
        const principalPaid = m === n ? balance : per;
        balance -= principalPaid;
        schedule.push({ month: grace + m, payment: principalPaid + interest, principal: principalPaid, interest, balance });
      }
    }
  }
  const totalInterest = schedule.reduce((s, e) => s + e.interest, 0);
  return {
    schedule,
    totalInterest,
    totalPayment: schedule.reduce((s, e) => s + e.payment, 0),
    firstPayment: schedule.length ? schedule[0].payment : 0,
  };
}

/// 중도상환수수료 부과 기간(개월). 금융소비자보호법상 대출일부터 3년 이내 상환에만 부과.
export const prepaymentFeeMonths = 36;

/// 중도상환수수료 = 상환금액 × 수수료율 × (부과기간 − 경과기간) / 부과기간.
/// 대출기간이 3년보다 짧으면 대출기간을 부과기간으로 쓴다. 경과기간이 부과기간 이상이면 0.
export function prepaymentFee({ amount, feeRatePercent, elapsedMonths, loanMonths }) {
  const period = Math.min(loanMonths, prepaymentFeeMonths);
  if (period <= 0 || elapsedMonths >= period) return 0;
  return amount * feeRatePercent / 100 * (period - elapsedMonths) / period;
}

/// 기간 단축 방식 스케줄: 원리금 균등은 기존 월 납입액, 원금 균등은 기존 월 원금 유지
function shortenedSchedule({ balance, annualRate, method, keepPayment, keepPrincipal, maxMonths }) {
  const r = annualRate / 100 / 12;
  const schedule = [];
  let b = balance;
  for (let m = 1; m <= maxMonths && b > 0.5; m++) {
    const interest = b * r;
    let principalPaid = method === 'equalPrincipal' ? keepPrincipal : keepPayment - interest;
    if (principalPaid <= 0) {
      return calculateLoan({ principal: b, annualRate, months: maxMonths - m + 1, method }).schedule;
    }
    if (m === maxMonths || principalPaid > b) principalPaid = b;
    b -= principalPaid;
    schedule.push({ month: m, payment: principalPaid + interest, principal: principalPaid, interest, balance: b });
  }
  return schedule;
}

/// 중도상환: 수수료와 잔여 이자 절감액 비교. [prepayMonth]회차 납입 직후 상환 가정.
/// effect: 'reducePayment'(월 납입액 감소) | 'shortenTerm'(기간 단축)
export function calculatePrepayment({
  principal, annualRate, months, method = 'amortization', graceMonths = 0,
  prepayMonth, prepayAmount, feeRatePercent, effect = 'reducePayment',
}) {
  const base = calculateLoan({ principal, annualRate, months, method, graceMonths });
  const m = Math.max(1, Math.min(prepayMonth, months));
  const balanceAtPrepay = base.schedule[m - 1].balance;
  const amount = Math.max(0, Math.min(prepayAmount, balanceAtPrepay));
  const fee = prepaymentFee({ amount, feeRatePercent, elapsedMonths: m, loanMonths: months });
  const feeExempt = m >= Math.min(months, prepaymentFeeMonths);

  const remainingInterestBefore = base.schedule.slice(m).reduce((s, e) => s + e.interest, 0);
  const paymentBefore = m < months ? base.schedule[m].payment : 0;

  const newBalance = balanceAtPrepay - amount;
  let remainingInterestAfter = 0;
  let paymentAfter = 0;
  let monthsAfter = 0;
  if (newBalance > 0.5 && m < months) {
    const remainGrace = Math.max(0, Math.min(graceMonths - m, months - m - 1));
    const canShorten = effect === 'shortenTerm' && method !== 'bullet' && remainGrace === 0;
    const after = canShorten
      ? shortenedSchedule({
        balance: newBalance, annualRate, method,
        keepPayment: base.schedule[m].payment, keepPrincipal: base.schedule[m].principal,
        maxMonths: months - m,
      })
      : calculateLoan({
        principal: newBalance, annualRate, months: months - m, method,
        graceMonths: method === 'bullet' ? 0 : remainGrace,
      }).schedule;
    remainingInterestAfter = after.reduce((s, e) => s + e.interest, 0);
    paymentAfter = after.length ? after[0].payment : 0;
    monthsAfter = after.length;
  }
  const interestSaved = remainingInterestBefore - remainingInterestAfter;
  return {
    fee,
    interestSaved,
    netBenefit: interestSaved - fee,
    remainingBalance: balanceAtPrepay,
    prepaidAmount: amount,
    paymentBefore,
    paymentAfter,
    remainingMonthsBefore: months - m,
    remainingMonthsAfter: monthsAfter,
    monthsSaved: months - m - monthsAfter,
    feeExempt,
  };
}

/// 상환 시점별 순이득 곡선 (그래프용). 수수료 면제 시점(36개월)과 그 직전은 항상 포함.
export function prepaymentBenefitCurve({
  principal, annualRate, months, method = 'amortization', graceMonths = 0,
  prepayAmount, feeRatePercent, effect = 'reducePayment', maxPoints = 40,
}) {
  if (months < 2) return [];
  const last = months - 1;
  const step = Math.max(1, Math.ceil(last / maxPoints));
  const set = new Set();
  for (let m = 1; m <= last; m += step) set.add(m);
  set.add(last);
  if (prepaymentFeeMonths <= last) set.add(prepaymentFeeMonths);
  if (prepaymentFeeMonths - 1 >= 1 && prepaymentFeeMonths - 1 <= last) set.add(prepaymentFeeMonths - 1);
  return [...set].sort((a, b) => a - b).map((month) => {
    const r = calculatePrepayment({
      principal, annualRate, months, method, graceMonths, prepayMonth: month, prepayAmount, feeRatePercent, effect,
    });
    return { month, netBenefit: r.netBenefit, fee: r.fee };
  });
}

/// 대환(갈아타기): 잔금 [balance]를 새 금리·새 기간으로 옮길 때의 이자 절감과 비용 비교.
/// 손익분기는 회차별 "이자" 차이의 누적이 비용을 넘는 시점 (납입액 차이에는 원금이 섞여 있어 쓰지 않음).
/// 총이자 기준 순손실이면 손익분기 없음(null).
export function calculateRefinance({
  balance, currentRate, remainingMonths, method = 'amortization',
  newRate, newMonths, elapsedMonths, feeRatePercent, extraCosts = 0,
}) {
  const current = calculateLoan({ principal: balance, annualRate: currentRate, months: remainingMonths, method });
  const next = calculateLoan({ principal: balance, annualRate: newRate, months: newMonths, method });
  const fee = prepaymentFee({
    amount: balance, feeRatePercent, elapsedMonths, loanMonths: elapsedMonths + remainingMonths,
  });
  const cost = fee + extraCosts;
  const netSaving = current.totalInterest - next.totalInterest - cost;

  let breakEvenMonth = null;
  if (netSaving >= 0) {
    let cumulative = 0;
    const horizon = Math.max(remainingMonths, newMonths);
    for (let k = 0; k < horizon; k++) {
      const a = k < current.schedule.length ? current.schedule[k].interest : 0;
      const b = k < next.schedule.length ? next.schedule[k].interest : 0;
      cumulative += a - b;
      if (cumulative >= cost) { breakEvenMonth = k + 1; break; }
    }
  }
  return {
    currentMonthlyPayment: current.firstPayment,
    newMonthlyPayment: next.firstPayment,
    remainingInterestCurrent: current.totalInterest,
    totalInterestNew: next.totalInterest,
    interestSaved: current.totalInterest - next.totalInterest,
    prepaymentFee: fee,
    extraCosts,
    switchingCost: cost,
    netSaving,
    breakEvenMonth,
  };
}
