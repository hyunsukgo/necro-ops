// Autopsy table — timeline + evidence + report (placeholder, built out in task 8.3 & 8.4)
export default function IncidentPage({ params }: { params: { id: string } }) {
  return (
    <main className="mx-auto max-w-6xl px-4 py-12">
      <h1 className="mb-2 text-3xl font-bold tracking-tight text-formaldehyde-green">
        Autopsy — Incident {params.id}
      </h1>
      <p className="text-morgue-muted italic">Coming in tasks 8.3 & 8.4…</p>
    </main>
  );
}
