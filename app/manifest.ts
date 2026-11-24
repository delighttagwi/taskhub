import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: 'APP SURVEY',
    short_name: 'APP SURVEY',
    description: 'Discover app testing tasks and earn verified rewards.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#f5f8f8',
    theme_color: '#245d78',
    icons: [
      { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
    ],
  };
}
