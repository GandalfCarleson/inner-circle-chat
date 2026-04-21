export function VoidSplashScreen() {
  return (
    <div className="void-splash">
      <div className="void-splash-stars" aria-hidden="true" />
      <div className="void-splash-orbit-glow" aria-hidden="true" />
      <div className="void-splash-network-glow" aria-hidden="true" />

      <div className="void-splash-constellation" aria-hidden="true">
        <svg viewBox="0 0 320 360" className="h-[19rem] w-[19rem]">
          <defs>
            <linearGradient id="void-constellation-line-a" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="rgba(123, 101, 206, 0.9)" />
              <stop offset="100%" stopColor="rgba(98, 194, 243, 0.78)" />
            </linearGradient>
            <linearGradient id="void-constellation-line-b" x1="20%" y1="10%" x2="90%" y2="90%">
              <stop offset="0%" stopColor="rgba(255, 191, 113, 0.84)" />
              <stop offset="100%" stopColor="rgba(133, 106, 214, 0.68)" />
            </linearGradient>
            <radialGradient id="void-node-core-main" cx="50%" cy="50%" r="60%">
              <stop offset="0%" stopColor="rgba(214, 217, 255, 0.98)" />
              <stop offset="100%" stopColor="rgba(142, 126, 236, 0.94)" />
            </radialGradient>
            <radialGradient id="void-node-core-cyan" cx="50%" cy="50%" r="62%">
              <stop offset="0%" stopColor="rgba(204, 248, 255, 0.98)" />
              <stop offset="100%" stopColor="rgba(71, 227, 255, 0.94)" />
            </radialGradient>
            <filter id="void-node-glow" x="-80%" y="-80%" width="260%" height="260%">
              <feGaussianBlur stdDeviation="4.1" result="blurred" />
              <feMerge>
                <feMergeNode in="blurred" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          <circle cx="160" cy="184" r="116" stroke="rgba(95,130,212,0.22)" strokeWidth="1" fill="none" />
          <path d="M49 174C59 114 102 75 160 68C220 61 272 98 284 154" stroke="rgba(157,129,225,0.22)" strokeWidth="1" fill="none" />
          <path d="M57 252C96 307 184 329 252 286C286 264 304 226 304 184" stroke="rgba(70,162,215,0.16)" strokeWidth="1" fill="none" />
          <path d="M91 94C135 60 194 55 241 82" stroke="rgba(244,181,106,0.12)" strokeWidth="1" fill="none" />
          <path d="M70 134C97 223 181 256 262 226" stroke="rgba(90,147,225,0.11)" strokeWidth="1" fill="none" />
          <path d="M120 302C96 250 98 174 129 128" stroke="rgba(128,117,216,0.08)" strokeWidth="1" fill="none" />

          <path d="M140 182L188 80L84 120L77 220L175 284L260 182L140 182Z" stroke="url(#void-constellation-line-a)" strokeWidth="1.1" fill="none" />
          <path d="M84 120L188 80L260 182" stroke="url(#void-constellation-line-b)" strokeWidth="1" fill="none" />
          <path d="M77 220L175 284L140 182" stroke="rgba(82,196,244,0.74)" strokeWidth="1" fill="none" />
          <path d="M84 120L77 220" stroke="rgba(153,138,229,0.58)" strokeWidth="1" fill="none" />
          <path d="M188 80L260 182" stroke="rgba(244,179,103,0.54)" strokeWidth="1" fill="none" />
          <path d="M260 182L175 284" stroke="rgba(98,189,240,0.62)" strokeWidth="1" fill="none" />
          <path d="M140 182L84 120" stroke="rgba(168,146,236,0.54)" strokeWidth="1" fill="none" />
          <path d="M140 182L77 220" stroke="rgba(130,156,236,0.52)" strokeWidth="1" fill="none" />

          <g filter="url(#void-node-glow)">
            <circle cx="140" cy="182" r="8.6" fill="url(#void-node-core-main)" className="void-node-pulse-main" />
            <circle cx="188" cy="80" r="5.1" fill="rgba(174,139,245,0.96)" className="void-node-pulse-a" />
            <circle cx="84" cy="120" r="4.9" fill="rgba(196,103,255,0.95)" className="void-node-pulse-b" />
            <circle cx="77" cy="220" r="5" fill="rgba(120,145,255,0.93)" className="void-node-pulse-a" />
            <circle cx="175" cy="284" r="6.2" fill="url(#void-node-core-cyan)" className="void-node-pulse-main" />
            <circle cx="260" cy="182" r="5" fill="rgba(255,149,62,0.95)" className="void-node-pulse-c" />
            <circle cx="244" cy="150" r="3.1" fill="rgba(255,200,108,0.9)" className="void-node-pulse-c" />
            <circle cx="96" cy="262" r="2.1" fill="rgba(46,157,255,0.82)" className="void-node-pulse-b" />
            <circle cx="249" cy="96" r="2.05" fill="rgba(139,109,243,0.76)" className="void-node-pulse-a" />
            <circle cx="271" cy="108" r="1.6" fill="rgba(142,117,221,0.58)" className="void-node-pulse-b" />
          </g>
        </svg>
      </div>

      <div className="void-splash-brand">
        <h1>VOID</h1>
        <p>Connected. Private. Yours.</p>
      </div>

      <div className="void-splash-loader" aria-hidden="true">
        <span className="void-splash-loader-dot" />
      </div>
    </div>
  );
}
