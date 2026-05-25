# Do-Not-Recur Digest — Sprint 003

[high] TanStack Router Vite plugin declared in package.json but not loaded in vite.config.ts — auto_fixable=true — first_seen=wave-1
[low] Build-time Vite plugin (@tanstack/router-plugin) listed in dependencies instead of devDependencies — auto_fixable=true — first_seen=wave-1
[blocking] docker compose config -q fails due to required env var POSTGRES_PASSWORD missing in validation context — auto_fixable=false — first_seen=wave-2
[high] FormControl wraps children in div instead of Slot breaking label-input association — auto_fixable=true — first_seen=wave-2
[medium] nginx proxy_pass missing X-Forwarded-Proto and WebSocket upgrade headers — auto_fixable=true — first_seen=wave-2
[low] nginx config missing security headers (X-Content-Type-Options, X-Frame-Options) — auto_fixable=true — first_seen=wave-2
[medium] FormLabel error check uses strict !== undefined instead of falsy check — auto_fixable=true — first_seen=wave-2
[blocking] Biome format error on vite.config.ts plugins line exceeding lineWidth — auto_fixable=true — first_seen=wave-3
[medium] Router lacks queryClient in context needed by protected-shell beforeLoad guard — auto_fixable=false — first_seen=wave-3
[low] queryKey duplication between meQueryOptions and useMe in me.ts — auto_fixable=true — first_seen=wave-3
[low] Unnecessary arrow wrapper around api.login in useLogin mutationFn — auto_fixable=true — first_seen=wave-3
[high] __protected route uses path segment instead of pathless layout; dashboard URL is /__protected/dashboard not /dashboard — auto_fixable=false — first_seen=wave-4
[high] Post-login navigates to /dashboard but route tree registers dashboard at /__protected/dashboard — auto_fixable=false — first_seen=wave-4
[medium] location.search is parsed object in TanStack Router; concatenating with pathname produces [object Object] in redirect — auto_fixable=false — first_seen=wave-4
[high] Lint gate pnpm -w lint runs repo-wide and fails on pre-existing apps/api errors outside wave diff — auto_fixable=false — first_seen=wave-4
[low] Redirect validation does not reject javascript: or data: URI schemes — auto_fixable=true — first_seen=wave-4
