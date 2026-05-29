import { TanStackDevtools } from "@tanstack/react-devtools";
import type { QueryClient } from "@tanstack/react-query";
import {
	createRootRouteWithContext,
	HeadContent,
	Scripts,
} from "@tanstack/react-router";
import { TanStackRouterDevtoolsPanel } from "@tanstack/react-router-devtools";
import Header from "#/components/Header";
import NotFound from "#/components/NotFound";
import {
	ASSET_URL_PATTERN,
	CHUNK_LOAD_MESSAGE_PATTERN,
	CHUNK_RECOVERY_THROTTLE_MS,
} from "#/constants/script/script-constants";
import {
	CHUNK_RELOAD_STORAGE_KEY,
	THEME_STORAGE_KEY,
} from "#/constants/storage/storage-constants";
import {
	THEME_COLOR_SCHEME_QUERY,
	ThemeMode,
} from "#/constants/theme/theme-constants";
import { AuthProvider } from "#/hooks/useAuth";

import TanStackQueryDevtools from "../integrations/tanstack-query/devtools";
import TanStackQueryProvider from "../integrations/tanstack-query/root-provider";
import appCss from "../styles.css?url";

interface MyRouterContext {
	queryClient: QueryClient;
}

const THEME_INIT_SCRIPT = `(function(){try{var stored=window.localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});var mode=(stored===${JSON.stringify(ThemeMode.Light)}||stored===${JSON.stringify(ThemeMode.Dark)}||stored===${JSON.stringify(ThemeMode.Auto)})?stored:${JSON.stringify(ThemeMode.Auto)};var prefersDark=window.matchMedia(${JSON.stringify(THEME_COLOR_SCHEME_QUERY)}).matches;var resolved=mode===${JSON.stringify(ThemeMode.Auto)}?(prefersDark?${JSON.stringify(ThemeMode.Dark)}:${JSON.stringify(ThemeMode.Light)}):mode;var root=document.documentElement;root.classList.remove(${JSON.stringify(ThemeMode.Light)},${JSON.stringify(ThemeMode.Dark)});root.classList.add(resolved);if(mode===${JSON.stringify(ThemeMode.Auto)}){root.removeAttribute('data-theme')}else{root.setAttribute('data-theme',mode)}root.style.colorScheme=resolved;}catch(e){}})();`;

const CHUNK_RECOVERY_SCRIPT = `(function(){var key=${JSON.stringify(CHUNK_RELOAD_STORAGE_KEY)};var assetPattern=new RegExp(${JSON.stringify(ASSET_URL_PATTERN.source)},${JSON.stringify(ASSET_URL_PATTERN.flags)});var chunkPattern=new RegExp(${JSON.stringify(CHUNK_LOAD_MESSAGE_PATTERN.source)},${JSON.stringify(CHUNK_LOAD_MESSAGE_PATTERN.flags)});function recent(){try{var value=Number(sessionStorage.getItem(key)||0);return Date.now()-value<${CHUNK_RECOVERY_THROTTLE_MS}}catch(e){return false}}function mark(){try{sessionStorage.setItem(key,String(Date.now()))}catch(e){}}function isAssetUrl(value){return typeof value==='string'&&assetPattern.test(value)}function isChunkMessage(value){return typeof value==='string'&&chunkPattern.test(value)}function recover(){if(recent())return;mark();window.location.reload()}window.addEventListener('error',function(event){var target=event.target;if(target&&(target.tagName==='SCRIPT'||target.tagName==='LINK')&&isAssetUrl(target.src||target.href)){recover();return}if(isChunkMessage(event.message)||isAssetUrl(event.filename)){recover()}},true);window.addEventListener('unhandledrejection',function(event){var reason=event.reason;var message=reason&&(reason.message||String(reason));if(isChunkMessage(message)){recover()}});})();`;

export const Route = createRootRouteWithContext<MyRouterContext>()({
	head: () => ({
		meta: [
			{
				charSet: "utf-8",
			},
			{
				name: "viewport",
				content: "width=device-width, initial-scale=1",
			},
			{
				title: "EgoFlow Dashboard",
			},
		],
		links: [
			{
				rel: "stylesheet",
				href: appCss,
			},
		],
	}),
	shellComponent: RootDocument,
	notFoundComponent: NotFound,
});

function RootDocument({ children }: { children: React.ReactNode }) {
	return (
		<html lang="en" suppressHydrationWarning>
			<head>
				{/* biome-ignore lint/security/noDangerouslySetInnerHtml: static startup scripts prevent theme flash and recover stale chunks. */}
				<script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
				{/* biome-ignore lint/security/noDangerouslySetInnerHtml: static startup scripts prevent theme flash and recover stale chunks. */}
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
								position: "bottom-right",
							}}
							plugins={[
								{
									name: "Tanstack Router",
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
	);
}
