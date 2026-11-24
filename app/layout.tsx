import type { Metadata } from 'next';
import PwaInstallButton from './PwaInstallButton';
import './globals.css';

export const metadata: Metadata = {
  title: 'APP SURVEY | Test apps. Earn rewards.',
  description: 'Discover app testing tasks and earn verified rewards.',
  manifest: '/manifest.webmanifest',
  icons: { icon: '/icon.svg', apple: '/icon.svg' },
  appleWebApp: { capable: true, statusBarStyle: 'default', title: 'APP SURVEY' },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
