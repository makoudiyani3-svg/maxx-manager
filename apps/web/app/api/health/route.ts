export async function GET() {
  return Response.json({
    status: "ok",
    service: "maxx-manager",
    timestamp: new Date().toISOString(),
  });
}
