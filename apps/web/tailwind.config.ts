import type { Config } from 'tailwindcss';

/**
 * 緣舍命理 design tokens（design_handoff_yuanshe/README.md §4，數值逐字照抄 design/site.dc.html）
 *
 * - screens：mobile-first。< 760px 為手機；xs(420) 只用在 Hero 標題 32 → 38px
 * - 原型沒有全域 box-sizing，預設是 content-box；Tailwind preflight 會改成 border-box，
 *   有「固定寬高 + 邊框/內距」的元素要加 `box-content` 才會和原型同尺寸
 * - 原型 body 沒設 line-height（瀏覽器預設 normal），globals.css 已把 preflight 的 1.5 改回 normal
 * - 原型大量 rgba 顏色都能用 opacity modifier 表示：rgba(185,38,90,.18) = rose-600/[.18]、
 *   rgba(138,23,64,.35) = rose-800/35、rgba(99,20,47,.28) = ink-900/[.28]
 */

const SATIN =
  'linear-gradient(118deg,#ffd9e6 0%,#fff0f5 16%,#ffb9d0 34%,#ffe2ec 48%,#f9a3c0 66%,#ffe7f0 82%,#ffc7db 100%)';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', './lib/**/*.{ts,tsx}'],
  future: {
    // hover: 只在可 hover 的裝置生效（@media (hover:hover) and (pointer:fine)），觸控後不會黏住
    hoverOnlyWhenSupported: true,
  },
  theme: {
    screens: {
      xs: '420px',
      md: '760px',
    },
    // 色票整組取代 Tailwind 預設，只留設計稿有的顏色
    colors: {
      inherit: 'inherit',
      current: 'currentColor',
      transparent: 'transparent',
      white: '#fff',
      black: '#000',
      ink: {
        900: '#63142f', // 主標題、深色文字、Footer 底色
        700: '#6b2540', // 摘要內文
        600: '#7a3450', // 內文
        500: '#8a4a63', // 次要說明
        400: '#a06a80', // 註記、署名
      },
      rose: {
        800: '#8a1740', // 品牌深紅、價格、Logo 字
        600: '#b9265a', // 主強調、序號、選中框
        500: '#e04c7f', // 按鈕漸層端（README 另列 #e0417a，原型實際只用 #e04c7f）
        300: '#e8749c', // 按鈕漸層起點、摘要上緣
        accent: '#a8285c', // 英文小標（letter-spacing .4em）
        hover: '#7d1039', // 原型 a:hover
      },
      page: '#fff8fa', // bg-page
      soft: {
        DEFAULT: '#fff0f5', // hover、選中淺底
        2: '#fff5f8',
        3: '#ffeef4',
      },
      line: {
        DEFAULT: '#f0d5df',
        2: '#efcad8', // 輸入框框線
        3: '#f3d3df',
        4: '#f5dde6',
      },
      error: '#d0284f',
      footer: {
        text: '#f5cfdc',
        title: '#ffe4ee',
      },
      disabled: {
        text: '#d9bcc8',
        slot: '#cfb2be',
        'slot-bg': '#f7eef1',
      },
      pearl: {
        light: '#ffb3cc',
        deep: '#c33566',
      },
      chevron: '#d9a3b8', // 手機選單「›」
      input: '#fffafc', // 輸入框底
      step: {
        idle: '#f3d9e3', // 進度條未到
        'idle-text': '#b996a5',
      },
    },
    extend: {
      fontFamily: {
        serif: ['"Noto Serif TC"', 'serif'],
        sans: ['"Noto Sans TC"', 'sans-serif'],
      },
      backgroundImage: {
        satin: SATIN,
        // 主要按鈕
        btn: 'linear-gradient(120deg,#e8749c,#b9265a 48%,#8a1740)',
        // Nav「立即預約」
        'nav-btn': 'linear-gradient(120deg,#e04c7f,#b9265a 55%,#e8749c)',
        // 珍珠圓：Logo 用 42%，步驟號/完成勾用 40%
        'pearl-logo': 'radial-gradient(circle at 32% 28%,#fff 0%,#ffb3cc 42%,#c33566 100%)',
        pearl: 'radial-gradient(circle at 32% 28%,#fff 0%,#ffb3cc 40%,#c33566 100%)',
        halo: 'radial-gradient(circle at 38% 32%,rgba(255,255,255,.95) 0%,rgba(255,190,214,.9) 45%,rgba(226,110,152,.55) 100%)',
        'hero-line': 'linear-gradient(90deg,#b9265a,#f08fb4)',
        'svc-row': 'linear-gradient(180deg,#ffe4ee 0%,#fff8fa 100%)',
        review: 'linear-gradient(110deg,#ffeef4,#fff8fa 60%)',
        booking: 'linear-gradient(180deg,#ffeef4 0,#fff8fa 320px)',
        card: 'linear-gradient(150deg,#fff 0%,#ffeef4 100%)',
        selected: 'linear-gradient(120deg,#fff0f5,#ffe0eb)',
        'selected-strong': 'linear-gradient(135deg,#e8749c,#b9265a)',
        'pay-info': 'linear-gradient(135deg,#fff5f8,#ffe9f1)',
        'step-bar': 'linear-gradient(90deg,#e8749c,#b9265a)',
        sweep: 'linear-gradient(90deg,rgba(255,255,255,0),rgba(255,255,255,.9),rgba(255,255,255,0))',
      },
      boxShadow: {
        nav: '0 6px 20px -14px rgba(138,23,64,.4)',
        'nav-btn': '0 6px 16px -4px rgba(185,38,90,.6)',
        logo: '0 3px 10px rgba(195,53,102,.4)',
        burger: '0 4px 12px -6px rgba(138,23,64,.5)',
        menu: '0 30px 60px -20px rgba(99,20,47,.5)',
        btn: '0 12px 26px -10px rgba(138,23,64,.75)',
        'btn-sm': '0 10px 22px -10px rgba(138,23,64,.7)', // 預約頁「下一步」
        halo: '0 30px 60px -24px rgba(160,30,80,.5)',
        arch: '0 24px 50px -20px rgba(138,23,64,.55)', // 拱形人物框
        step: '0 6px 14px -6px rgba(185,38,90,.7)',
        card: '0 20px 40px -26px rgba(160,30,80,.6)',
        form: '0 20px 40px -30px rgba(138,23,64,.5)',
        summary: '0 20px 40px -24px rgba(160,30,80,.6)',
        'booking-bar': '0 -12px 30px -18px rgba(99,20,47,.5)',
        done: '0 30px 60px -30px rgba(138,23,64,.6)',
        'done-check': '0 12px 24px -10px rgba(185,38,90,.8)',
        cta: '0 16px 36px -14px rgba(99,20,47,.55)', // 手機浮動 CTA
      },
      borderRadius: {
        pill: '99px',
        arch: '180px 180px 24px 24px', // Hero 人物框
        'arch-lg': '200px 200px 24px 24px', // 老師頁照片
      },
      keyframes: {
        satinSweep: {
          '0%': { transform: 'translateX(-40%) skewX(-18deg)' },
          '100%': { transform: 'translateX(600%) skewX(-18deg)' },
        },
      },
      animation: {
        'satin-sweep': 'satinSweep 9s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};

export default config;
