/**
 * NewIncidentForm — client component for creating a new incident. Req 8.2
 */
"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

export function NewIncidentForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const form = e.currentTarget;
    const data = new FormData(form);

    const body = {
      title: (data.get("title") as string).trim(),
      startAt: data.get("startAt") as string,
      endAt: data.get("endAt") as string,
      services: (data.get("services") as string)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    };

    try {
      const res = await fetch("/api/incidents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const json = (await res.json()) as { error?: string };
        setError(json.error ?? "Failed to create incident");
        return;
      }

      const incident = (await res.json()) as { id: string };
      router.push(`/incidents/${incident.id}`);
    } catch {
      setError("Network error — please try again");
    } finally {
      setLoading(false);
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 rounded-lg border border-formaldehyde-green/50 bg-formaldehyde-green/10 px-4 py-2 text-sm font-semibold text-formaldehyde-green transition-colors hover:bg-formaldehyde-green/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-formaldehyde-green"
      >
        <span aria-hidden="true">＋</span> New Incident
      </button>
    );
  }

  return (
    <div className="rounded-xl border border-morgue-border bg-morgue-surface p-6 shadow-lg">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-bold text-morgue-text">Register Incident</h2>
        <button
          onClick={() => { setOpen(false); setError(null); }}
          className="text-morgue-muted hover:text-morgue-text"
          aria-label="Close"
        >
          ✕
        </button>
      </div>

      <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
        <div>
          <label htmlFor="title" className="mb-1 block text-sm font-medium text-morgue-muted">
            Title
          </label>
          <input
            id="title"
            name="title"
            type="text"
            required
            maxLength={200}
            placeholder="e.g. Payments OOMKill"
            className="w-full rounded-lg border border-morgue-border bg-morgue-bg px-3 py-2 text-morgue-text placeholder-morgue-muted/50 focus:border-formaldehyde-green focus:outline-none"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="startAt" className="mb-1 block text-sm font-medium text-morgue-muted">
              Start (UTC)
            </label>
            <input
              id="startAt"
              name="startAt"
              type="datetime-local"
              required
              className="w-full rounded-lg border border-morgue-border bg-morgue-bg px-3 py-2 text-morgue-text focus:border-formaldehyde-green focus:outline-none [color-scheme:dark]"
            />
          </div>
          <div>
            <label htmlFor="endAt" className="mb-1 block text-sm font-medium text-morgue-muted">
              End (UTC)
            </label>
            <input
              id="endAt"
              name="endAt"
              type="datetime-local"
              required
              className="w-full rounded-lg border border-morgue-border bg-morgue-bg px-3 py-2 text-morgue-text focus:border-formaldehyde-green focus:outline-none [color-scheme:dark]"
            />
          </div>
        </div>

        <div>
          <label htmlFor="services" className="mb-1 block text-sm font-medium text-morgue-muted">
            Services <span className="text-xs text-morgue-muted/60">(comma-separated)</span>
          </label>
          <input
            id="services"
            name="services"
            type="text"
            required
            placeholder="payments, auth-service"
            className="w-full rounded-lg border border-morgue-border bg-morgue-bg px-3 py-2 text-morgue-text placeholder-morgue-muted/50 focus:border-formaldehyde-green focus:outline-none"
          />
        </div>

        {error && (
          <p role="alert" className="rounded-lg border border-stitch-red/40 bg-stitch-red/10 px-3 py-2 text-sm text-stitch-red-light">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={() => { setOpen(false); setError(null); }}
            className="rounded-lg px-4 py-2 text-sm text-morgue-muted hover:text-morgue-text"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={loading}
            className="rounded-lg bg-formaldehyde-green px-4 py-2 text-sm font-semibold text-morgue-bg transition-opacity disabled:opacity-50"
          >
            {loading ? "Creating…" : "Exhume →"}
          </button>
        </div>
      </form>
    </div>
  );
}
