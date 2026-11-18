import type { WorldResident } from './layout.ts'

/** Demo townsfolk used only when a real user previews an empty city. */
export function demoPreviewResidents(viewerId: string, city: string): WorldResident[] {
  const place = city.trim() || 'your city'
  return [
    {
      id: 'demo:jordan',
      name: 'Jordan Lee',
      initials: 'JL',
      street: '16 Maple Ave',
      x: 2,
      y: 1,
      city: place,
    },
    {
      id: 'demo:sam',
      name: 'Sam Ortiz',
      initials: 'SO',
      street: '18 Oak St',
      x: 3,
      y: 3,
      city: place,
    },
    {
      id: 'demo:riley',
      name: 'Riley Park',
      initials: 'RP',
      street: '21 Cedar Ln',
      x: 5,
      y: 2,
      city: place,
    },
    {
      id: 'demo:maya',
      name: 'Maya Chen',
      initials: 'MC',
      street: '12 Birch Rd',
      x: 1,
      y: 4,
      city: place,
    },
  ].filter((resident) => resident.id !== viewerId)
}

export function worldEmptyCopy(city: string): string {
  const label = city.trim() || 'your city'
  return `You're the first one in ${label}. Invite a neighbor, or preview with demo neighbors.`
}
