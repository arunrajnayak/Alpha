'use client';

import { useState, useEffect, useRef, useTransition } from 'react';
import { checkMarketStatus } from '@/app/actions/market-status';

import { usePathname } from 'next/navigation';
import NextLink from 'next/link';

import { useRecompute } from '@/context/RecomputeContext';
import { useLiveData } from '@/context/LiveDataContext';
import { CircularProgress } from '@mui/material';
import Image from 'next/image';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faChartLine,
  faFilter,
  faFire,
  faBriefcase,
  faBolt,
  faRightFromBracket,
  faCamera,
  faGear,
  faBars,
  faXmark,
  faSignal,
  faEye,
  faEyeSlash
} from '@fortawesome/free-solid-svg-icons';
import { IconDefinition } from '@fortawesome/fontawesome-svg-core';

const menuItems: { text: string; path: string; icon: IconDefinition; hiddenOnMobile?: boolean }[] = [
  { text: 'Live', path: '/', icon: faSignal },
  { text: 'Dashboard', path: '/dashboard', icon: faChartLine },
  { text: 'Screener', path: '/screener', icon: faFilter },
  { text: 'Radar', path: '/radar', icon: faFire },
  { text: 'Portfolio', path: '/portfolio', icon: faBriefcase },
  { text: 'Snapshots', path: '/snapshots', icon: faCamera },
  { text: 'Trades', path: '/trades', icon: faBolt, hiddenOnMobile: true },
  { text: 'Exits', path: '/exits', icon: faRightFromBracket },
  { text: 'Settings', path: '/settings', icon: faGear },
];



export default function Header() {
  const pathname = usePathname();
  const { isRecomputing } = useRecompute();
  const { privacyMode, togglePrivacy } = useLiveData();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [marketOpen, setMarketOpen] = useState(false);
  const [timings, setTimings] = useState<{ start_time: number, end_time: number }[]>([]);
  const [lastDataDate, setLastDataDate] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  useEffect(() => {
    // Deferred fetch - doesn't block initial paint
    startTransition(() => {
      const checkServerStatus = async () => {
          const d = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
          const year = d.getFullYear();
          const month = String(d.getMonth() + 1).padStart(2, '0');
          const day = String(d.getDate()).padStart(2, '0');
          const dateStr = `${year}-${month}-${day}`;

          const result = await checkMarketStatus(dateStr);
          setTimings(result.timings);
          setMarketOpen(result.isOpen);
          setLastDataDate(result.lastDataDate);
      };
      checkServerStatus();
    });

    // Ticker
    const interval = setInterval(() => {
        setTimings(prevTimings => {
            if (prevTimings.length > 0) {
                const now = Date.now();
                const isOpen = prevTimings.some(t => now >= t.start_time && now <= t.end_time);
                setMarketOpen(isOpen);
            }
            return prevTimings;
        });
    }, 10000); // Check every 10s

    return () => clearInterval(interval);
  }, []);

  const getStatusLabel = () => {
     if (marketOpen) return 'Live';

     // If Upstox timings show market traded today and has closed, it's "Today"
     const now = Date.now();
     if (timings.length > 0 && timings.every(t => t.end_time < now)) {
         // Verify timings are from today (prevent stale timings across midnight)
         const latestEnd = new Date(Math.max(...timings.map(t => t.end_time)));
         const latestEndIST = new Date(latestEnd.toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
         const todayCheck = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
         if (latestEndIST.getDate() === todayCheck.getDate() &&
             latestEndIST.getMonth() === todayCheck.getMonth() &&
             latestEndIST.getFullYear() === todayCheck.getFullYear()) {
             return 'Today';
         }
     }

     if (!lastDataDate) return 'No Data';

     const d = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
     const year = d.getFullYear();
     const month = String(d.getMonth() + 1).padStart(2, '0');
     const day = String(d.getDate()).padStart(2, '0');
     const todayStr = `${year}-${month}-${day}`;

     if (lastDataDate === todayStr) return 'Today';

     // Format with weekday for clarity — avoids ambiguous "Yesterday" when market is closed
     const dateObj = new Date(lastDataDate + 'T12:00:00');
     return dateObj.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
  };
  
  const statusLabel = getStatusLabel();

  const [indicatorStyle, setIndicatorStyle] = useState({ left: 0, width: 0, opacity: 0 });
  const itemsRef = useRef<(HTMLAnchorElement | null)[]>([]);

  useEffect(() => {
    // Reset refs array to ensure it matches current items
    itemsRef.current = itemsRef.current.slice(0, menuItems.length);

    const activeIndex = menuItems.findIndex(item => item.path === pathname);
    if (activeIndex !== -1) {
        const activeEl = itemsRef.current[activeIndex];
        if (activeEl) {
          setIndicatorStyle({
            left: activeEl.offsetLeft,
            width: activeEl.offsetWidth,
            opacity: 1
          });
        }
    }
    
    // Close mobile menu when path changes
    setIsMobileMenuOpen(false);
  }, [pathname, statusLabel]);

  return (
    <>
    <nav className="w-full border-b border-white/5 sticky top-0 z-50 backdrop-blur-xl bg-gradient-to-r from-slate-900/95 via-slate-800/95 to-slate-900/95" style={{ paddingTop: 'env(safe-area-inset-top, 0)' }}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-16">
          {/* Brand */}
          <div className="flex-shrink-0 flex items-center gap-3">
             {/* Mobile Menu Button */}
             <button
                onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
                className="md:hidden p-2 text-gray-400 hover:text-white transition-colors"
                aria-label="Toggle menu"
              >
                <FontAwesomeIcon icon={isMobileMenuOpen ? faXmark : faBars} className="w-5 h-5" />
              </button>

            <NextLink href="/" className="group flex items-center gap-2">
              <Image 
                src="/logo.webp"
                alt="Alpha Logo"
                width={46}
                height={40}
                className="h-8 w-auto md:h-10 object-contain transition-all duration-300"
                priority
              />
            </NextLink>
          </div>

            <div className="flex items-center gap-4">
              {/* Recomputing Indicator */}
              {isRecomputing && (
                  <div className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-full bg-blue-500/10 border border-blue-500/20 animate-pulse">
                      <CircularProgress size={14} thickness={5} sx={{ color: '#60a5fa' }} />
                      <span className="text-xs font-semibold text-blue-400">Syncing...</span>
                  </div>
              )}

              {/* Desktop Navigation Links */}
              <div className="relative hidden md:flex items-center gap-1">
                 {/* Sliding Background */}
                 <div
                    className="absolute top-1 bottom-1 rounded-xl bg-gradient-to-r from-blue-600/20 via-indigo-500/20 to-violet-500/20 border border-blue-500/30 shadow-[0_0_15px_rgba(59,130,246,0.2)] transition-all duration-500 cubic-bezier(0.4, 0, 0.2, 1)"
                    style={{
                       left: indicatorStyle.left,
                       width: indicatorStyle.width,
                       opacity: indicatorStyle.opacity,
                    }}
                 />

                {menuItems.map((item, index) => {
                  const isActive = pathname === item.path;
                  return (
                    <NextLink
                      key={item.path}
                      ref={(el) => { itemsRef.current[index] = el; }}
                      href={item.path}
                      className={`relative z-10 px-3 md:px-4 py-3.5 rounded-xl text-base font-medium transition-colors duration-300 flex items-center gap-1.5 ${
                        isActive
                          ? 'text-blue-100 shadow-sm'
                          : 'text-gray-400 hover:text-gray-200'
                      }`}
                    >
                      {item.path === '/' ? (
                        <div className={`relative flex items-center justify-center w-4 h-4 mr-0.5 ${isActive ? 'scale-110' : ''}`}>
                          {marketOpen && <span className="animate-ping absolute inline-flex h-2 w-2 rounded-full bg-green-400 opacity-75"></span>}
                          <span className={`relative inline-flex rounded-full h-2 w-2 ${marketOpen ? 'bg-green-500' : 'bg-red-500'}`}></span>
                        </div>
                      ) : (
                        <FontAwesomeIcon
                          icon={item.icon}
                          className={`w-4 h-4 transition-transform duration-300 ${isActive ? 'scale-110 text-blue-400' : 'group-hover:text-white'}`}
                        />
                      )}
                      <span className={`${item.path === '/settings' ? 'hidden' : 'block'}`}>
                        {item.path === '/' && !marketOpen ? statusLabel : item.text}
                      </span>
                    </NextLink>
                  );
                })}
            </div>

            {/* Privacy Mode Toggle */}
            <button
              onClick={togglePrivacy}
              className={`w-8 h-8 flex items-center justify-center rounded-lg transition-all cursor-pointer ${
                privacyMode
                  ? 'bg-violet-500/20 text-violet-300 border border-violet-500/30'
                  : 'bg-white/5 hover:bg-white/10 text-gray-500 border border-transparent'
              }`}
              title={privacyMode ? 'Show Values' : 'Hide Values'}
            >
              <FontAwesomeIcon icon={privacyMode ? faEyeSlash : faEye} className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
      
      {/* Subtle gradient border at bottom */}
      <div className="h-px bg-gradient-to-r from-transparent via-blue-500/50 to-transparent" />
    </nav>

    {/* Mobile Menu Overlay & Drawer - OUTSIDE nav to avoid backdrop-blur containment issues */}
    <div className={`md:hidden relative z-[100] ${isMobileMenuOpen ? 'pointer-events-auto' : 'pointer-events-none'}`}>
        {/* Backdrop */}
        <div 
        className={`fixed inset-0 bg-black/60 backdrop-blur-sm transition-opacity duration-300 ${
            isMobileMenuOpen ? 'opacity-100' : 'opacity-0'
        }`}
        onClick={() => setIsMobileMenuOpen(false)}
        aria-hidden="true"
        />

        {/* Drawer */}
        <div 
        className={`fixed top-0 left-0 bottom-0 w-[280px] bg-slate-900 shadow-2xl border-r border-white/10 transform transition-transform duration-300 cubic-bezier(0.4, 0, 0.2, 1) ${
            isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
        style={{ paddingTop: 'env(safe-area-inset-top, 0)' }}
        >
        <div className="flex flex-col h-full">
            {/* Drawer Header */}
            <div className="h-16 flex items-center px-6 border-b border-white/5">
                <NextLink href="/" className="flex items-center gap-3" onClick={() => setIsMobileMenuOpen(false)}>
                    <Image 
                        src="/logo.webp"
                        alt="Alpha Logo"
                        width={40}
                        height={34}
                        className="h-8 w-auto object-contain"
                    />
                    <span className="text-lg font-bold text-white tracking-wide">Alpha</span>
                </NextLink>
            </div>

            {/* Drawer Items */}
            <div className="flex-1 overflow-y-auto scroll-smooth py-4 px-3 space-y-1">
                    {/* Mobile Sync Indicator inside Drawer */}
                {isRecomputing && (
                    <div className="flex items-center gap-3 px-3 py-3 mb-4 mx-1 rounded-xl bg-blue-500/10 border border-blue-500/20 animate-pulse">
                        <CircularProgress size={16} thickness={5} sx={{ color: '#60a5fa' }} />
                        <span className="text-sm font-semibold text-blue-400">Syncing Data...</span>
                    </div>
                )}

                {menuItems.filter(item => !item.hiddenOnMobile).map((item) => {
                    const isActive = pathname === item.path;
                    return (
                        <NextLink
                            key={item.path}
                            href={item.path}
                            className={`flex items-center gap-3 px-4 py-3 rounded-xl text-base font-medium transition-all duration-200 ${
                                isActive 
                                ? 'bg-blue-600/20 text-blue-100 border border-blue-500/20 shadow-[0_0_15px_rgba(59,130,246,0.1)]' 
                                : 'text-gray-400 hover:bg-white/5 hover:text-white'
                            }`}
                            onClick={() => setIsMobileMenuOpen(false)}
                        >
                            {item.path === '/' ? (
                                <div className={`relative flex items-center justify-center w-5 h-5 ${isActive ? 'scale-110' : ''}`}>
                                    {marketOpen && <span className="animate-ping absolute inline-flex h-2.5 w-2.5 rounded-full bg-green-400 opacity-75"></span>}
                                    <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${marketOpen ? 'bg-green-500' : 'bg-red-500'}`}></span>
                                </div>
                            ) : (
                                <FontAwesomeIcon 
                                    icon={item.icon} 
                                    className={`w-5 h-5 ${isActive ? 'text-blue-400' : 'text-gray-500'}`} 
                                />
                            )}
                            {item.path === '/' && !marketOpen ? statusLabel : item.text}
                        </NextLink>
                    );
                })}
            </div>
            
            {/* Drawer Footer */}
            <div className="p-4 border-t border-white/5 bg-black/20 flex items-center justify-between">
                <div className="text-xs text-gray-600">
                    &copy; 2026 Alpha Portfolio
                </div>
                <button
                  onClick={togglePrivacy}
                  className={`w-8 h-8 flex items-center justify-center rounded-lg transition-all cursor-pointer ${
                    privacyMode
                      ? 'bg-violet-500/20 text-violet-300 border border-violet-500/30'
                      : 'bg-white/5 text-gray-500 border border-transparent'
                  }`}
                  title={privacyMode ? 'Show Values' : 'Hide Values'}
                >
                  <FontAwesomeIcon icon={privacyMode ? faEyeSlash : faEye} className="w-4 h-4" />
                </button>
            </div>
        </div>
        </div>
    </div>
    </>
  );
}
