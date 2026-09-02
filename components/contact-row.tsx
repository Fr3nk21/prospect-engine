'use client'
import { useRouter } from 'next/navigation'
import { CategoryTag, NewVenueBadge, StatusDot, Rating } from '@/components/contact-badges'
import type { ContactListItem } from '@/lib/contacts'

export default function ContactRow({
  contact,
  selected,
  onToggleSelect,
}: {
  contact: ContactListItem
  selected: boolean
  onToggleSelect: () => void
}) {
  const router = useRouter()
  return (
    <tr onClick={() => router.push(`/contacts/${contact.id}`)}>
      <td className="checkbox-col" onClick={(e) => e.stopPropagation()}>
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggleSelect}
          aria-label={`Select ${contact.name}`}
        />
      </td>
      <td>
        <div className="biz-name">{contact.name}</div>
        <div className="biz-sub">
          {contact.business_type ?? '—'}
          {contact.suburb ? ` · ${contact.suburb}` : ''}
        </div>
      </td>
      <td>
        <CategoryTag value={contact.category} />
        {contact.is_new_venue && <NewVenueBadge />}
      </td>
      <td className="right">
        <Rating value={contact.rating} reviews={contact.review_count} />
      </td>
      <td>
        <StatusDot value={contact.status} />
      </td>
      <td className="right mono dim">{contact.last_contact_date ?? '—'}</td>
      <td className="center mono ig-status-cell">
        {contact.has_screenshots || contact.instagram_score !== null ? (
          <span title={contact.instagram_score !== null ? `Instagram score: ${contact.instagram_score}/100` : 'Screenshots uploaded'}>
            📷{contact.instagram_score !== null ? ` ${contact.instagram_score}` : ''}
          </span>
        ) : (
          <span className="dim">—</span>
        )}
      </td>
    </tr>
  )
}