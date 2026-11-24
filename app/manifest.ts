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
    background_color: '#f1f8f3',
    theme_color: '#111d42',
    icons: [
      { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
    ],
  };
}
