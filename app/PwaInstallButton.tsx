'use client';

import { useEffect, useRef, useState } from 'react';

type InstallPrompt = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
};

export default function PwaInstallButton() {
  const [installPrompt, setInstallPrompt] = useState<InstallPrompt | null>(null);
  const [installed, setInstalled] = useState(false);
  const [iosInstructions, setIosInstructions] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches
      || (navigator as Navigator & { standalone?: boolean }).standalone === true;
    setInstalled(isStandalone);

    const onBeforeInstall = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as InstallPrompt);
    };
    const onInstalled = () => setInstalled(true);

    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('appinstalled', onInstalled);
    if ('serviceWorker' in navigator) {
      void navigator.serviceWorker.register('/sw.js').catch(() => undefined);
    }

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  async function handleInstall() {
    if (!installPrompt) {
      setIosInstructions(/iPad|iPhone|iPod/.test(navigator.userAgent));
      dialogRef.current?.showModal();
      return;
    }

    await installPrompt.prompt();
    const choice = await installPrompt.userChoice;
    if (choice.outcome === 'accepted') setInstalled(true);
    setInstallPrompt(null);
  }

  if (installed) return null;

  return <>
    <button className="install-button" type="button" onClick={() => void handleInstall()} aria-label="Install APP SURVEY">
      <span aria-hidden="true">↓</span> Install app
    </button>
    <dialog className="install-dialog" ref={dialogRef} aria-labelledby="install-title">
      <div className="install-dialog-content">
        <span className="eyebrow">APP SURVEY</span>
        <h2 id="install-title">Add to your home screen</h2>
        <p>{iosInstructions
          ? 'Tap Share in your browser, then choose Add to Home Screen.'
          : 'Open your browser menu and choose Install app or Add to Home screen.'}</p>
        <button className="button dark" type="button" onClick={() => dialogRef.current?.close()}>Got it</button>
      </div>
    </dialog>
  </>;
}
