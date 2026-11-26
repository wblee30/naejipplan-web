// 전 페이지 공용 앱 유입 도우미:
// 1) Play 링크에 중복 없이 utm_source/medium/campaign/content 부착
// 2) iOS(Safari) 방문자에게는 설치 불가한 Play 버튼 대신 '홈 화면에 추가' 안내 표시
// 3) 선택적 GA4 측정 훅 (GA_MEASUREMENT_ID가 비어 있으면 외부 요청·쿠키 없음)

(function () {
  const PLAY_BASE = 'https://play.google.com/store/apps/details?id=com.wblee.loan_calculator';
  // GA4 측정 ID (naejipplan.com 웹 스트림)
  const GA_MEASUREMENT_ID = 'G-KF8H92HJPP';

  function detectOs(ua, platform, maxTouchPoints) {
    const s = ua || '';
    if (/iPhone|iPad|iPod/i.test(s) || (platform === 'MacIntel' && (maxTouchPoints || 0) > 1)) {
      return 'ios';
    }
    if (/Android/i.test(s)) return 'android';
    return 'other';
  }

  function inferPageMeta(pathname) {
    const clean = (pathname || '/').replace(/\/+$/, '') || '/';
    if (clean === '/') return { medium: 'home', campaign: 'landing' };
    if (clean.startsWith('/guide/')) {
      const slug = clean.slice('/guide/'.length);
      return { medium: 'guide', campaign: slug || 'guide_index' };
    }
    if (clean === '/guide') return { medium: 'guide', campaign: 'guide_index' };
    const map = {
      '/stress-dsr': { medium: 'calculator', campaign: 'stress_dsr' },
      '/acquisition-cost': { medium: 'calculator', campaign: 'acquisition_cost' },
      '/prepayment': { medium: 'calculator', campaign: 'prepayment' },
      '/refinance': { medium: 'calculator', campaign: 'refinance' },
      '/about': { medium: 'info', campaign: 'about' },
      '/privacy': { medium: 'info', campaign: 'privacy' },
      '/terms': { medium: 'info', campaign: 'terms' },
    };
    return map[clean] || { medium: 'web', campaign: clean.replace(/^\//, '').replace(/\//g, '_') || 'landing' };
  }

  function buildPlayUrl(rawHref, fallbackMeta, placement) {
    let url;
    try {
      url = new URL(rawHref || PLAY_BASE);
    } catch (_) {
      url = new URL(PLAY_BASE);
    }
    const existingRef = url.searchParams.get('referrer');
    const refParams = new URLSearchParams(existingRef || '');
    if (!refParams.get('utm_source')) refParams.set('utm_source', 'web');
    if (!refParams.get('utm_medium')) refParams.set('utm_medium', fallbackMeta.medium);
    if (!refParams.get('utm_campaign')) refParams.set('utm_campaign', fallbackMeta.campaign);
    if (placement) refParams.set('utm_content', placement);
    url.searchParams.set('referrer', refParams.toString());
    return url.toString();
  }

  function setupGa() {
    if (!GA_MEASUREMENT_ID || typeof document === 'undefined') return () => {};
    window.dataLayer = window.dataLayer || [];
    function gtag() { window.dataLayer.push(arguments); }
    window.gtag = window.gtag || gtag;
    gtag('js', new Date());
    gtag('config', GA_MEASUREMENT_ID, { anonymize_ip: true });
    const s = document.createElement('script');
    s.async = true;
    s.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(GA_MEASUREMENT_ID)}`;
    document.head.appendChild(s);
    return (name, params) => {
      try { window.gtag('event', name, params); } catch (_) {}
    };
  }

  function isStandaloneIos() {
    return Boolean(
      (typeof window !== 'undefined' && window.navigator && window.navigator.standalone) ||
      (typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(display-mode: standalone)').matches)
    );
  }

  function showIosModal() {
    let dlg = document.getElementById('ios-a2hs-sheet');
    if (!dlg) {
      dlg = document.createElement('div');
      dlg.id = 'ios-a2hs-sheet';
      dlg.className = 'ios-sheet-backdrop';
      dlg.setAttribute('role', 'dialog');
      dlg.setAttribute('aria-modal', 'true');
      dlg.setAttribute('aria-label', '아이폰 홈 화면에 추가 안내');
      dlg.innerHTML = `
        <div class="ios-sheet">
          <h3>아이폰에서 앱처럼 쓰기</h3>
          <p>내집플랜 앱은 현재 Android만 지원합니다. iPhone에서는 Safari에서 홈 화면에 추가해 두고 바로 열 수 있습니다.</p>
          <ol>
            <li>Safari 하단의 <b>공유(□↑)</b> 버튼을 누릅니다.</li>
            <li><b>홈 화면에 추가</b>를 선택하면 아이콘이 생깁니다.</li>
          </ol>
          <div class="ios-sheet-actions">
            <a class="ios-sheet-sub" href="${buildPlayUrl(PLAY_BASE, inferPageMeta(location.pathname), 'ios_modal_android')}" rel="noopener">Android 앱 보기</a>
            <button type="button" class="ios-sheet-close">닫기</button>
          </div>
        </div>`;
      dlg.addEventListener('click', (e) => {
        if (e.target === dlg || e.target.closest('.ios-sheet-close')) {
          dlg.hidden = true;
        }
      });
      document.body.appendChild(dlg);
    }
    dlg.hidden = false;
  }

  function init() {
    const meta = inferPageMeta(location.pathname);
    const os = detectOs(navigator.userAgent, navigator.platform, navigator.maxTouchPoints);
    const track = setupGa();

    // 1) 모든 Play Store 링크에 UTM + placement 정규화
    const links = document.querySelectorAll('a[href*="play.google.com/store/apps/details?id=com.wblee.loan_calculator"]');
    links.forEach((a) => {
      const placement = a.dataset.placement ||
        (a.closest('header.site') ? 'header' :
          a.closest('.result-cta') ? 'result_inline' :
          a.closest('.cta') ? 'bottom_cta' : 'inline');
      a.dataset.placement = placement;
      a.href = buildPlayUrl(a.getAttribute('href'), meta, placement);
      a.addEventListener('click', () => {
        track('app_cta_click', { placement, campaign: meta.campaign, medium: meta.medium, os });
      });
    });

    // 2) 계산기 첫 상호작용 추적 (GA4 활성 시 1회)
    const calcForm = document.getElementById('form');
    if (calcForm) {
      let sent = false;
      const onInteract = () => {
        if (sent) return;
        sent = true;
        track('calc_interact', { campaign: meta.campaign, os });
      };
      calcForm.addEventListener('input', onInteract, { once: true });
      calcForm.addEventListener('change', onInteract, { once: true });
    }

    // 3) iOS 방문자 분기: 설치 불가한 Play 버튼 대신 홈 화면 추가 안내로 전환
    if (os === 'ios') {
      const standalone = isStandaloneIos();
      document.querySelectorAll('header.site a[data-placement="header"]').forEach((a) => {
        if (standalone) {
          a.hidden = true;
          return;
        }
        a.textContent = '홈 화면 추가';
        a.setAttribute('href', '#ios-home');
        a.addEventListener('click', (e) => {
          e.preventDefault();
          showIosModal();
        });
      });

      document.querySelectorAll('.result-cta').forEach((box) => {
        if (standalone) {
          box.hidden = true;
          return;
        }
        const a = box.querySelector('a');
        const txt = box.querySelector('.result-cta-text');
        if (txt) {
          txt.innerHTML = '<b>아이폰에서 다시 찾으려면</b> Safari 공유(□↑) → <b>홈 화면에 추가</b>로 앱처럼 바로 열 수 있어요.';
        }
        if (a) {
          const playHref = a.href;
          a.textContent = '추가 방법';
          a.setAttribute('href', '#ios-home');
          a.addEventListener('click', (e) => {
            e.preventDefault();
            showIosModal();
          });
          a.dataset.androidHref = playHref;
        }
      });

      document.querySelectorAll('section.cta').forEach((sec) => {
        if (standalone) {
          sec.hidden = true;
          return;
        }
        const a = sec.querySelector('a[href*="play.google.com"]');
        if (!a) return;
        const androidHref = a.href;
        const h2 = sec.querySelector('h2');
        const p = sec.querySelector('p');
        if (h2) h2.textContent = '아이폰에서는 홈 화면에 추가해 쓰세요';
        if (p) {
          p.textContent = '내집플랜 앱은 현재 Android만 지원합니다. Safari 하단 공유(□↑) → "홈 화면에 추가"를 누르면 앱처럼 바로 열 수 있습니다.';
        }
        a.textContent = '홈 화면 추가 방법';
        a.setAttribute('href', '#ios-home');
        a.addEventListener('click', (e) => {
          e.preventDefault();
          showIosModal();
        });
        const sub = document.createElement('a');
        sub.className = 'cta-sub-link';
        sub.href = androidHref;
        sub.textContent = 'Android 앱 보기 (Google Play)';
        a.insertAdjacentElement('afterend', sub);
      });
    }
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { detectOs, inferPageMeta, buildPlayUrl };
  } else if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', init);
    } else {
      init();
    }
  }
})();
