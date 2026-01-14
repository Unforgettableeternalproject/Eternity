export const prerender = false;

import type { APIRoute } from 'astro';

export const GET: APIRoute = async ({ locals }) => {
  const runtimeKey = (locals.runtime?.env?.RESEND_API_KEY as string | undefined);
  const importMetaKey = import.meta.env.RESEND_API_KEY as string | undefined;
  
  const envInfo = {
    runtime_env_available: !!locals.runtime?.env,
    runtime_RESEND_API_KEY_exists: !!runtimeKey,
    runtime_RESEND_API_KEY_prefix: runtimeKey?.substring(0, 8) || 'NOT_SET',
    importmeta_RESEND_API_KEY_exists: !!importMetaKey,
    importmeta_RESEND_API_KEY_prefix: importMetaKey?.substring(0, 8) || 'NOT_SET',
    final_key_source: runtimeKey ? 'runtime' : (importMetaKey ? 'import.meta' : 'none'),
    DEV: import.meta.env.DEV,
    PROD: import.meta.env.PROD,
    MODE: import.meta.env.MODE,
  };

  return new Response(JSON.stringify(envInfo, null, 2), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
