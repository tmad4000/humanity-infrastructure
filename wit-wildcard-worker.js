addEventListener('fetch', event => {
  event.respondWith(handle(event.request))
})

async function handle(request) {
  const url = new URL(request.url)
  const originalHost = url.hostname

  // Proxy to the Pages deployment, passing original host so the app knows the subdomain
  const targetUrl = new URL(request.url)
  targetUrl.hostname = 'worldissuetracker.pages.dev'

  const headers = new Headers(request.headers)
  headers.set('X-Forwarded-Host', originalHost)
  // Keep original Host so Pages app can read subdomain
  headers.set('Host', originalHost)

  const proxyReq = new Request(targetUrl.toString(), {
    method: request.method,
    headers,
    body: ['GET', 'HEAD'].includes(request.method) ? undefined : request.body,
    redirect: 'manual',
  })

  const resp = await fetch(proxyReq)

  // Pass response through as-is (including redirects)
  return new Response(resp.body, {
    status: resp.status,
    statusText: resp.statusText,
    headers: resp.headers,
  })
}
