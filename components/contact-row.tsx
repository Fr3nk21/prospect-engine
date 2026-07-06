'use client'

import { useRouter } from 'next/navigation'
import { CategoryTag, NewVenueBadge, StatusDot, Rating } from '@/components/contact-badges'
import type { ContactListItem } from '@/lib/contacts'

export default function ContactRow({ contact }: { contact: ContactListItem }) {
  const router = useRouter()

  return (
    <tr onClick={() => router.push(`/contacts/${contact.id}`)}>
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
    </tr>
  )
}
