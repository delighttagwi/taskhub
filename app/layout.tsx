import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'APP SURVEY | Test apps. Earn rewards.',
  description: 'Discover app testing tasks and earn verified rewards.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
