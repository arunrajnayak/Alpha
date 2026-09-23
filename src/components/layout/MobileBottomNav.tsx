'use client';

import { usePathname } from 'next/navigation';
import NextLink from 'next/link';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faSignal,
  faHeartPulse,
  faChartLine,
  faFilter,
  faBriefcase,
} from '@fortawesome/free-solid-svg-icons';
import { haptic } from '@/lib/mobile';

const navTabs = [
  { name: 'Live', path: '/', icon: faSignal },
  { name: 'Markets', path: '/market', icon: faHeartPulse },
  { name: 'Dashboard', path: '/dashboard', icon: faChartLine },
  { name: 'Screener', path: '/screener', icon: faFilter },
  { name: 'Portfolio', path: '/portfolio', icon: faBriefcase },
];

export default function MobileBottomNav() {
  const pathname = usePathname();

  const handleTabClick = (path: string) => {
    if (pathname !== path) {
      haptic('light');
    }
  };

  return (
    <nav
      aria-label="Mobile Navigation"
      className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-[#0a0f1a]/92 backdrop-blur-xl border-t border-slate-800/80 transition-all select-none"
      style={{
        paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 0.35rem)',
      }}
    >
      <div className="grid grid-cols-5 h-14 max-w-lg mx-auto">
        {navTabs.map((tab) => {
          const isActive =
            tab.path === '/'
              ? pathname === '/'
              : pathname === tab.path || pathname.startsWith(`${tab.path}/`);

          return (
            <NextLink
              key={tab.path}
              href={tab.path}
              onClick={() => handleTabClick(tab.path)}
              className={`flex flex-col items-center justify-center relative py-1 transition-colors duration-150 ${
                isActive
                  ? 'text-blue-400 font-semibold'
                  : 'text-slate-400 hover:text-slate-200 active:text-slate-300'
              }`}
            >
              {isActive && (
                <span className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-[2px] bg-blue-500 rounded-full shadow-[0_0_8px_rgba(59,130,246,0.8)]" />
              )}
              <FontAwesomeIcon
                icon={tab.icon}
                className={`text-base mb-1 transition-transform ${
                  isActive ? 'scale-110 text-blue-400' : ''
                }`}
              />
              <span className="text-[11px] leading-tight tracking-tight">
                {tab.name}
              </span>
            </NextLink>
          );
        })}
      </div>
    </nav>
  );
}
