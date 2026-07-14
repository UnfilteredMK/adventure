import { NextRequest } from 'next/server';
import { DesignSettings } from '@/types';

export async function GET(
  request: NextRequest,
  { params }: { params: { instanceId: string } }
) {
  const { searchParams } = new URL(request.url);
  const fullPage = searchParams.get('fullPage') === 'true';
  const deployment = searchParams.get('deployment') === 'true';
  const configStr = searchParams.get('config');
  const config = configStr ? JSON.parse(configStr) as DesignSettings : null;

  // Determine widget host using environment variable
  const rawWidgetHost = process.env.NEXT_PUBLIC_WIDGET_URL || 'http://localhost:3001';
  const widgetHost = /^https?:\/\//i.test(rawWidgetHost) ? rawWidgetHost : `http://${rawWidgetHost}`;
  const widgetOrigin = new URL(widgetHost).origin;

  // Create the HTML content for the preview
  // NOTE: This endpoint intentionally avoids hardcoding Next.js chunk URLs from the widget app.
  // The internal/form experience is unified under /adventure/:instanceId, so we preview via an iframe.
  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Adventure Preview</title>
  
  <style>
    html, body {
      margin: 0;
      padding: 0;
      width: 100%;
      height: 100%;
      overflow: hidden;
      background: #ffffff;
    }
    #adventure-frame {
      width: 100%;
      height: 100%;
      display: block;
      border: 0;
    }
  </style>
</head>
<body>
  <iframe id="adventure-frame" title="Adventure Preview"></iframe>
  <script>
    (function() {
      const instanceId = ${JSON.stringify(params.instanceId)};
      const widgetHost = ${JSON.stringify(widgetHost)};
      const widgetOrigin = ${JSON.stringify(widgetOrigin)};
      const fullPage = ${JSON.stringify(fullPage)};
      const deployment = ${JSON.stringify(deployment)};
      const config = ${JSON.stringify(config)};

      const iframe = document.getElementById('adventure-frame');
      const u = new URL('/adventure/' + encodeURIComponent(instanceId), widgetHost);
      u.searchParams.set('surface', 'embed');
      if (fullPage) u.searchParams.set('fullPage', 'true');
      if (deployment) u.searchParams.set('deployment', 'true');
      iframe.src = u.toString();

      function postConfig() {
        if (!config) return;
        try {
          const payload = { config, timestamp: Date.now() };
          iframe.contentWindow && iframe.contentWindow.postMessage({ type: 'UPDATE_CONFIG', ...payload }, widgetOrigin);
          iframe.contentWindow && iframe.contentWindow.postMessage({ type: 'UPDATE_FLOW_CONFIG', ...payload }, widgetOrigin);
        } catch {}
      }

      // Best-effort: send on load, and again when the embedded app signals readiness.
      iframe.addEventListener('load', () => {
        setTimeout(postConfig, 50);
      });

      window.addEventListener('message', (event) => {
        if (event.source !== iframe.contentWindow || event.origin !== widgetOrigin) return;
        const data = event && event.data;
        const type = data && typeof data === 'object' ? data.type : null;
        if (!type) return;
        if (
          type === 'WIDGET_READY' ||
          type === 'FORM_READY' ||
          type === 'SIF_READY' ||
          type === 'UPDATE_CONFIG_ACK' ||
          type === 'UPDATE_FLOW_CONFIG_ACK'
        ) {
          postConfig();
        }
      });
    })();
  </script>
</body>
</html>
  `.trim();

  return new Response(html, {
    headers: {
      'Content-Type': 'text/html',
    },
  });
} 
