import {
  HeadContent,
  Scripts,
  createRootRouteWithContext,
} from '@tanstack/react-router'
import { TanStackRouterDevtoolsPanel } from '@tanstack/react-router-devtools'
import { TanStackDevtools } from '@tanstack/react-devtools'

import TanStackQueryProvider from '../integrations/tanstack-query/root-provider'
import Header from '#/components/Header'
import NotFound from '#/components/NotFound'
import { AuthProvider } from '#/hooks/useAuth'

import TanStackQueryDevtools from '../integrations/tanstack-query/devtools'

import appCss from '../styles.css?url'

import type { QueryClient } from '@tanstack/react-query'

interface MyRouterContext {
  queryClient: QueryClient
}

const THEME_INIT_SCRIPT = `(function(){try{var stored=window.localStorage.getItem('theme');var mode=(stored==='light'||stored==='dark'||stored==='auto')?stored:'auto';var prefersDark=window.matchMedia('(prefers-color-scheme: dark)').matches;var resolved=mode==='auto'?(prefersDark?'dark':'light'):mode;var root=document.documentElement;root.classList.remove('light','dark');root.classList.add(resolved);if(mode==='auto'){root.removeAttribute('data-theme')}else{root.setAttribute('data-theme',mode)}root.style.colorScheme=resolved;}catch(e){}})();`

const CHUNK_RECOVERY_SCRIPT = `(function(){var key='egoflow:chunk-reload-at';function recent(){try{var value=Number(sessionStorage.getItem(key)||0);return Date.now()-value<30000}catch(e){return false}}function mark(){try{sessionStorage.setItem(key,String(Date.now()))}catch(e){}}function isAssetUrl(value){return typeof value==='string'&&/\\/assets\\/.*\\.(js|css)(\\?|$)/.test(value)}function isChunkMessage(value){return typeof value==='string'&&/(Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Loading chunk|Load failed)/i.test(value)}function recover(){if(recent())return;mark();window.location.reload()}window.addEventListener('error',function(event){var target=event.target;if(target&&(target.tagName==='SCRIPT'||target.tagName==='LINK')&&isAssetUrl(target.src||target.href)){recover();return}if(isChunkMessage(event.message)||isAssetUrl(event.filename)){recover()}},true);window.addEventListener('unhandledrejection',function(event){var reason=event.reason;var message=reason&&(reason.message||String(reason));if(isChunkMessage(message)){recover()}});})();`

export const Route = createRootRouteWithContext<MyRouterContext>()({
  head: () => ({
    meta: [
      {
        charSet: 'utf-8',
      },
      {
        name: 'viewport',
        content: 'width=device-width, initial-scale=1',
      },
      {
        title: 'EgoFlow Dashboard',
      },
    ],
    links: [
      {
        rel: 'stylesheet',
        href: appCss,
      },
    ],
  }),
  shellComponent: RootDocument,
  notFoundComponent: NotFound,
})

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        <script dangerouslySetInnerHTML={{ __html: CHUNK_RECOVERY_SCRIPT }} />
        <HeadContent />
      </head>
      <body className="font-sans antialiased [overflow-wrap:anywhere] selection:bg-[rgba(79,184,178,0.24)]">
        <TanStackQueryProvider>
          <AuthProvider>
            <Header />
            {children}
            <TanStackDevtools
              config={{
                position: 'bottom-right',
              }}
              plugins={[
                {
                  name: 'Tanstack Router',
                  render: <TanStackRouterDevtoolsPanel />,
                },
                TanStackQueryDevtools,
              ]}
            />
          </AuthProvider>
        </TanStackQueryProvider>
        <Scripts />
      </body>
    </html>
  )
}
