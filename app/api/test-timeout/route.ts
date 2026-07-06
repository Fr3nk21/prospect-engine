export const maxDuration = 60

export async function GET() {
  const start = Date.now()
  await new Promise((resolve) => setTimeout(resolve, 65_000))
  return Response.json({
    message: 'Completed without timeout',
    elapsed_ms: Date.now() - start,
  })
}
