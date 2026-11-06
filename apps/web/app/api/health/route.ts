// Liveness probe for deploy checks. No upstream calls, no secrets.
export function GET() {
  return Response.json({ ok: true });
}
