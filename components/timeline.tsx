import { HISTORY_ICON, type ContactEvent } from '@/lib/contacts'

export default function Timeline({ events }: { events: ContactEvent[] }) {
  if (events.length === 0) {
    return <p className="dim hint">No activity recorded for this contact yet.</p>
  }

  return (
    <ul className="timeline">
      {events.map((event) => (
        <li key={event.id} className={`hist-${event.type}`}>
          <span className="mono dim">
            {HISTORY_ICON[event.type]} {event.created_at.slice(0, 10)}
          </span>
          <p>{event.body}</p>
        </li>
      ))}
    </ul>
  )
}
