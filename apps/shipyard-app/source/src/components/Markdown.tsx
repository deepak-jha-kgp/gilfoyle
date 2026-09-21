/** GitHub-flavoured Markdown, rendered the way GitHub renders it.
 *
 *  The hand-rolled version this replaces handled paragraphs, bullets and
 *  `code` — which is roughly what an agent writes and nothing like what a bot
 *  writes. A CodeRabbit review comment is GFM tables, fenced blocks, `<details>`
 *  sections, `<img>` badges and a pile of `<!-- -->` markers, and rendering that
 *  as plain text produced the mess this file exists to fix.
 *
 *  `marked` parses it; **DOMPurify sanitises the result before it goes near the
 *  DOM.** That is what makes `dangerouslySetInnerHTML` defensible here: this
 *  content is untrusted — it is whatever a stranger typed on a public pull
 *  request — and an allow-list sanitiser is the standard answer, not a hope.
 */
import { useMemo, useState } from 'react'
import DOMPurify from 'dompurify'
import { marked } from 'marked'

marked.setOptions({ gfm: true, breaks: true })

/** Comments GitHub hides. Bots use them as machine markers and they are pure
 *  noise on screen — the old renderer showed every one of them. */
const HTML_COMMENT = /<!--[\s\S]*?-->/g

const ALLOWED_TAGS = [
  'p', 'br', 'hr', 'em', 'strong', 'del', 'code', 'pre', 'blockquote',
  'ul', 'ol', 'li', 'a', 'img', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'table', 'thead', 'tbody', 'tr', 'th', 'td', 'details', 'summary', 'span', 'div',
]

function toHtml(source: string): string {
  const cleaned = source.replace(HTML_COMMENT, '')
  const raw = marked.parse(cleaned, { async: false }) as string
  return DOMPurify.sanitize(raw, {
    ALLOWED_TAGS,
    ALLOWED_ATTR: ['href', 'src', 'alt', 'title', 'align', 'open'],
    // Anything that could navigate the parent or run is refused outright.
    FORBID_TAGS: ['style', 'script', 'iframe', 'form', 'input', 'button'],
    FORBID_ATTR: ['style', 'onerror', 'onload', 'onclick', 'target'],
    ALLOW_DATA_ATTR: false,
  })
}

/** Long bot comments are most of a screen each. Clamp and let people open them. */
const LONG = 2200

export function Markdown({ text }: { text: string }) {
  const html = useMemo(() => toHtml(text), [text])
  const [open, setOpen] = useState(false)
  const long = text.length > LONG

  return (
    <div className={`md${long && !open ? ' clamped' : ''}`}>
      <div className="md-body" dangerouslySetInnerHTML={{ __html: html }} />
      {long && (
        <button className="md-more" onClick={() => setOpen((v) => !v)}>
          {open ? 'Show less' : 'Show more'}
        </button>
      )}
    </div>
  )
}
