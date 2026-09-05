'use client';
import { useEffect, useState } from 'react';
import { Download, Share, PlusSquare, X, Smartphone } from 'lucide-react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export function PwaRegister() {
  const [installPrompt, setInstallPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [isIOS, setIsIOS] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);
  const [showIOSModal, setShowIOSModal] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => undefined);
    }

    // Check if already running in standalone / installed mode
    const isStandaloneMode =
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as unknown as { standalone?: boolean }).standalone ===
        true;
    setIsStandalone(isStandaloneMode);

    // Check if user dismissed banner previously in this session
    const hasDismissed =
      sessionStorage.getItem('killer-pwa-dismissed') === 'true';
    if (hasDismissed) {
      setDismissed(true);
    }

    // Detect iOS (iPhone, iPad, iPod)
    const userAgent = window.navigator.userAgent.toLowerCase();
    const isIOSDevice =
      /iphone|ipad|ipod/.test(userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

    if (isIOSDevice && !isStandaloneMode) {
      setIsIOS(true);
    }

    const handler = (e: Event) => {
      e.preventDefault();
      setInstallPrompt(e as BeforeInstallPromptEvent);
    };

    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const handleInstall = async () => {
    if (isIOS) {
      setShowIOSModal(true);
      return;
    }

    if (!installPrompt) return;
    await installPrompt.prompt();
    const choice = await installPrompt.userChoice;
    if (choice.outcome === 'accepted') {
      setInstallPrompt(null);
    }
  };

  const handleDismiss = () => {
    setDismissed(true);
    try {
      sessionStorage.setItem('killer-pwa-dismissed', 'true');
    } catch {
      // ignore storage failure
    }
  };

  if (isStandalone || dismissed || (!installPrompt && !isIOS)) return null;

  return (
    <>
      <div className='pwa-install-banner'>
        <div className='pwa-install-info'>
          <span className='pwa-install-title'>
            <Smartphone size={14} className='pwa-inline-icon' /> ติดตั้งแอพ
            KILLER
          </span>
          <small className='pwa-install-desc'>
            {isIOS
              ? 'เพิ่มไปยังหน้าจอโฮมเพื่อเล่นแบบเต็มจอและรองรับการแจ้งเตือน'
              : 'ติดตั้งลงบนหน้าจอหลักเพื่อความลื่นไหลและรับการแจ้งเตือน'}
          </small>
        </div>
        <div className='pwa-install-actions'>
          <button
            className='pwa-install-btn'
            onClick={handleInstall}
            type='button'
          >
            <Download size={14} /> {isIOS ? 'วิธีติดตั้ง' : 'ติดตั้ง'}
          </button>
          <button
            className='pwa-dismiss-btn'
            onClick={handleDismiss}
            type='button'
            aria-label='ปิด'
          >
            <X size={15} />
          </button>
        </div>
      </div>

      {showIOSModal && (
        <div
          className='pwa-ios-modal-overlay'
          onClick={() => setShowIOSModal(false)}
        >
          <div
            className='pwa-ios-modal'
            onClick={(e) => e.stopPropagation()}
            role='dialog'
            aria-modal='true'
            aria-labelledby='pwa-ios-title'
          >
            <div className='pwa-ios-modal-header'>
              <div className='pwa-ios-title-wrap'>
                <span className='section-kicker'>PWA INSTALLATION</span>
                <h3 id='pwa-ios-title'>ติดตั้ง KILLER บน iOS</h3>
              </div>
              <button
                className='pwa-dismiss-btn'
                onClick={() => setShowIOSModal(false)}
                type='button'
                aria-label='ปิดคำแนะนำ'
              >
                <X size={18} />
              </button>
            </div>

            <p className='pwa-ios-lead'>
              บน iPhone/iPad คุณสามารถติดตั้งเว็บให้เหมือนแอพจริงได้ผ่าน Safari:
            </p>

            <ol className='pwa-ios-steps'>
              <li>
                <div className='pwa-step-icon'>
                  <Share size={18} />
                </div>
                <div className='pwa-step-text'>
                  <strong>1. กดปุ่มแชร์ (Share)</strong>
                  <span>แตะที่ไอคอนแชร์ที่แถบเมนูด้านล่างของ Safari</span>
                </div>
              </li>
              <li>
                <div className='pwa-step-icon'>
                  <PlusSquare size={18} />
                </div>
                <div className='pwa-step-text'>
                  <strong>2. เลือก &quot;เพิ่มไปยังหน้าจอโฮม&quot;</strong>
                  <span>
                    (Add to Home Screen) เลื่อนลงมาในเมนูแชร์เพื่อกดเลือก
                  </span>
                </div>
              </li>
              <li>
                <div className='pwa-step-icon'>
                  <Download size={18} />
                </div>
                <div className='pwa-step-text'>
                  <strong>3. กด &quot;เพิ่ม&quot; (Add)</strong>
                  <span>
                    ยืนยันที่มุมขวาบน แอพ KILLER
                    จะปรากฏบนหน้าจอโฮมพร้อมใช้งานทันที
                  </span>
                </div>
              </li>
            </ol>

            <button
              className='primary-action pwa-ios-close-btn'
              onClick={() => setShowIOSModal(false)}
              type='button'
            >
              เข้าใจแล้ว
            </button>
          </div>
        </div>
      )}
    </>
  );
}
