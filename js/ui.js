// 계산기 페이지 공용 UI 도우미: 금액 표기, 입력 필터, URL 쿼리 동기화, 앱 링크 유입 표시.

export const comma = new Intl.NumberFormat('ko-KR');

/// 원 단위 금액을 "3억 2,500만원"처럼 표기
export function wonKorean(amount) {
  const v = Math.round(amount);
  if (v === 0) return '0원';
  const sign = v < 0 ? '-' : '';
  const abs = Math.abs(v);
  const eok = Math.floor(abs / 1e8);
  const man = Math.floor((abs % 1e8) / 1e4);
  const parts = [];
  if (eok > 0) parts.push(`${comma.format(eok)}억`);
  if (man > 0) parts.push(`${comma.format(man)}만`);
  if (!parts.length) parts.push(comma.format(abs));
  return `${sign}${parts.join(' ')}원`;
}

/// 만원 단위로 반올림한 한글 금액
export const manwon = (won) => wonKorean(Math.round(won / 1e4) * 1e4);

/// 콤마 포함 문자열 → 숫자 (빈 값·오입력은 0)
export const num = (s) => {
  const n = parseFloat(String(s).replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
};

/// 개월 수를 "N년 M개월"로
export function monthsText(months) {
  const y = Math.floor(months / 12);
  const m = months % 12;
  if (y && m) return `${y}년 ${m}개월`;
  if (y) return `${y}년`;
  return `${m}개월`;
}

/// data-money(만원·콤마), data-int, data-decimal 입력 필터를 붙인다.
export function attachInputFilters(form) {
  form.querySelectorAll('[data-money]').forEach((el) => el.addEventListener('input', () => {
    const digits = el.value.replace(/[^0-9]/g, '').slice(0, 8);
    el.value = digits ? comma.format(Number(digits)) : '';
  }));
  form.querySelectorAll('[data-int]').forEach((el) => el.addEventListener('input', () => {
    el.value = el.value.replace(/[^0-9]/g, '').slice(0, 3);
  }));
  form.querySelectorAll('[data-decimal]').forEach((el) => el.addEventListener('input', () => {
    const m = el.value.replace(/[^0-9.]/g, '').match(/^\d{0,2}(\.\d{0,2})?/);
    el.value = m ? m[0] : '';
  }));
}

/// data-money 입력 아래 .korean[data-for=id]에 한글 금액을 표시한다.
export function showKoreanAmounts(form) {
  form.querySelectorAll('[data-money]').forEach((el) => {
    const out = form.querySelector(`.korean[data-for="${el.id}"]`);
    if (!out) return;
    const v = num(el.value) * 1e4;
    out.textContent = v > 0 ? wonKorean(v) : '';
  });
}

/// 입력값을 URL 쿼리에 담아 블로그 글에서 예시 조건으로 링크할 수 있게 한다.
export function urlSync(form, keys) {
  return {
    load() {
      const p = new URLSearchParams(location.search);
      keys.forEach((k) => {
        if (!p.has(k)) return;
        const v = p.get(k);
        const el = form.elements[k];
        if (!el) return;
        if (el instanceof RadioNodeList) {
          const opt = form.querySelector(`input[name="${k}"][value="${CSS.escape(v)}"]`);
          if (opt) opt.checked = true;
        } else if (el.type === 'checkbox') {
          el.checked = v === '1';
        } else if (el.tagName === 'SELECT') {
          if ([...el.options].some((o) => o.value === v)) el.value = v;
        } else {
          el.value = el.hasAttribute('data-money') ? comma.format(num(v)) : String(num(v));
        }
      });
    },
    save() {
      const p = new URLSearchParams();
      keys.forEach((k) => {
        const el = form.elements[k];
        if (!el) return;
        const v = el.type === 'checkbox' ? (el.checked ? '1' : '') : String(el.value).replace(/,/g, '');
        if (v) p.set(k, v);
      });
      history.replaceState(null, '', `${location.pathname}?${p}`);
    },
  };
}

/// Play 설치 링크(.app-link)에 유입 경로를 붙인다 (Play Console 획득 보고서용).
export function tagAppLinks(campaign) {
  const referrer = encodeURIComponent(`utm_source=web&utm_medium=calculator&utm_campaign=${campaign}`);
  document.querySelectorAll('.app-link').forEach((a) => { a.href += `&referrer=${referrer}`; });
}
