import { forwardChat } from '../../../server/apiClient';

export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  const upstream = await forwardChat(await request.text());
  const headers = new Headers({ 'content-type': 'application/json' });
  if (upstream.requestId) headers.set('x-request-id', upstream.requestId);
  return new Response(upstream.body, { status: upstream.status, headers });
}
