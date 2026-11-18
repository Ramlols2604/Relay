/**
 * Lightweight chat map — pure SVG from coordinates / distances. No Mapbox, no network.
 */

import { type ChatMapPoint } from '../data/chatMapPreview.ts'

type ChatMapPreviewProps = {
  points: readonly ChatMapPoint[]
  /** Optional title for accessibility. */
  title?: string
}

const WIDTH = 280
const HEIGHT = 160
const PAD = 18

export function ChatMapPreview({ points, title = 'Nearby lenders' }: ChatMapPreviewProps) {
  const framed = framePoints(points)

  return (
    <figure className="chat-map-preview" data-testid="chat-map-preview">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="img"
        aria-label={title}
        width="100%"
        height={HEIGHT}
      >
        <rect x="0" y="0" width={WIDTH} height={HEIGHT} className="chat-map-preview-bg" rx="12" />
        {[1, 2, 3].map((ring) => (
          <circle
            key={ring}
            cx={WIDTH / 2}
            cy={HEIGHT / 2}
            r={(Math.min(WIDTH, HEIGHT) / 2 - PAD) * (ring / 3)}
            className="chat-map-preview-ring"
          />
        ))}
        {framed.points.map((point) => (
          <g key={point.id}>
            <circle
              cx={point.px}
              cy={point.py}
              r={point.kind === 'you' ? 7 : point.number != null ? 8 : 5}
              className={point.kind === 'you' ? 'chat-map-preview-you' : 'chat-map-preview-lender'}
            />
            {point.number != null ? (
              <text
                x={point.px}
                y={point.py}
                textAnchor="middle"
                dominantBaseline="central"
                className="chat-map-preview-number"
                aria-hidden="true"
              >
                {point.number}
              </text>
            ) : null}
            <title>{point.label}</title>
          </g>
        ))}
        <g className="chat-map-preview-scale" aria-hidden="true">
          <line
            x1={PAD}
            y1={HEIGHT - 12}
            x2={PAD + framed.scalePx}
            y2={HEIGHT - 12}
            strokeWidth="2"
          />
          <text x={PAD} y={HEIGHT - 16} className="chat-map-preview-scale-label">
            {framed.scaleLabel}
          </text>
        </g>
      </svg>
      <figcaption className="sr-only">{title}</figcaption>
    </figure>
  )
}

function framePoints(points: readonly ChatMapPoint[]) {
  const xs = points.map((point) => point.x)
  const ys = points.map((point) => point.y)
  const minX = Math.min(0, ...xs)
  const maxX = Math.max(0, ...xs)
  const minY = Math.min(0, ...ys)
  const maxY = Math.max(0, ...ys)
  const spanX = Math.max(maxX - minX, 1)
  const spanY = Math.max(maxY - minY, 1)
  const span = Math.max(spanX, spanY) * 1.2
  const scale = (Math.min(WIDTH, HEIGHT) - PAD * 2) / span
  const mapped = points.map((point) => ({
    ...point,
    px: WIDTH / 2 + (point.x - (minX + maxX) / 2) * scale,
    py: HEIGHT / 2 - (point.y - (minY + maxY) / 2) * scale,
  }))
  const blocks = Math.max(1, Math.round(span / 2))
  const scalePx = Math.max(24, Math.min(80, scale * blocks))
  return {
    points: mapped,
    scalePx,
    scaleLabel: blocks <= 1 ? '~1 block' : `~${blocks} blocks`,
  }
}
